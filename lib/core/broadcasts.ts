import "server-only";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { canManageEvents, getMembership } from "@/lib/permissions";
import {
  broadcastAudienceSchema,
  eventBroadcastDraftRefSchema,
  previewEventBroadcastSchema,
  saveEventBroadcastDraftSchema,
  sendEventBroadcastSchema,
  sendEventBroadcastTestSchema,
} from "@/lib/validators";
import type { ZodError } from "zod";
import { DEFAULT_BROADCAST_DESIGN, isBroadcastDesign } from "@/lib/email/broadcastDesigns";
import type { EventBroadcastDraftDto } from "@/lib/broadcastDraftAutosave";
import type { ActionResult } from "@/app/actions/org";
import { flattenZodErrors } from "@/app/actions/utils";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { broadcastBrandFor, broadcastBrandSelect, broadcastEventUrl, resolveBroadcastRecipients, sanitizeBroadcastHtml } from "@/lib/eventBroadcast";
import { broadcastHtmlToText, renderBroadcastHtml, renderBroadcastTemplate, sampleBroadcastVariables } from "@/lib/broadcastTemplate";
import { buildBroadcastEmail } from "@/lib/email";
import { enqueueEventBroadcastRecipients, enqueueEventBroadcastTest } from "@/lib/outbox";
import { startOutboxWorker } from "@/lib/outboxWorker";

type BroadcastContext =
  | { ok: false; error: string }
  | { ok: true; org: { id: string; slug: string }; event: { id: string; title: string } };

/**
 * Broadcasts are organisation-admin operations, like every other RSVP
 * lifecycle action: they reveal who registered and email attendees in bulk.
 */
async function requireBroadcastContext(userId: string, organisationSlug: string, eventId: string): Promise<BroadcastContext> {
  const org = await prisma.organisation.findUnique({ where: { slug: organisationSlug }, select: { id: true, slug: true } });
  if (!org) return { ok: false, error: "Organisation not found." };
  const membership = await getMembership(userId, org.id);
  if (!canManageEvents(membership)) return { ok: false, error: "You do not have permission to email attendees." };
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: org.id }, select: { id: true, title: true } });
  if (!event) return { ok: false, error: "Event not found." };
  return { ok: true, org, event };
}

/** Editor output is reduced to the supported subset; an empty result means the organiser only entered formatting. */
function cleanBody(body: string): { ok: true; body: string } | { ok: false; error: string } {
  const sanitized = sanitizeBroadcastHtml(body);
  if (!broadcastHtmlToText(sanitized).trim()) return { ok: false, error: "The message is empty." };
  return { ok: true, body: sanitized };
}

export async function countBroadcastRecipientsForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ count: number }>> {
  const userId = actorUserId;
  if (!userId) return { ok: false, error: "You must be signed in." };
  const parsed = broadcastAudienceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid audience.", fieldErrors: flattenZodErrors(parsed.error) };

  const context = await requireBroadcastContext(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return { ok: false, error: context.error };

  const recipients = await resolveBroadcastRecipients(prisma, context.event.id, parsed.data);
  return { ok: true, data: { count: recipients.length } };
}

/** The exact email a recipient would receive, rendered with example values for the dashboard preview. */
export async function previewEventBroadcastForUser(
  actorUserId: string | null,
  input: unknown,
  options: { imageBaseUrl?: string } = {},
): Promise<ActionResult<{ subject: string; html: string; text: string }>> {
  const userId = actorUserId;
  if (!userId) return { ok: false, error: "You must be signed in." };
  const parsed = previewEventBroadcastSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = flattenZodErrors(parsed.error);
    return { ok: false, error: fieldErrors.subject?.[0] ?? fieldErrors.body?.[0] ?? "Invalid input.", fieldErrors };
  }

  const context = await requireBroadcastContext(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return { ok: false, error: context.error };
  const event = await prisma.event.findFirst({
    where: { id: context.event.id },
    select: { title: true, slug: true, startDateTime: true, timezone: true, location: true, isOnline: true, ...broadcastBrandSelect, organisation: { select: { name: true, slug: true, logoUrl: true } } },
  });
  if (!event) return { ok: false, error: "Event not found." };

  const body = cleanBody(parsed.data.body);
  if (!body.ok) return { ok: false, error: body.error };
  const variables = sampleBroadcastVariables({
    title: event.title,
    startDateTime: event.startDateTime,
    timezone: event.timezone,
    location: event.location,
    isOnline: event.isOnline,
    eventUrl: broadcastEventUrl(event.organisation.slug, event.slug),
    organisationName: event.organisation.name,
  });
  const bodyHtml = renderBroadcastHtml(body.body, variables);
  const email = buildBroadcastEmail({
    subject: renderBroadcastTemplate(parsed.data.subject, variables),
    bodyHtml,
    bodyText: broadcastHtmlToText(bodyHtml),
    eventTitle: event.title,
    organisationName: event.organisation.name,
    design: parsed.data.design,
    brand: broadcastBrandFor(event),
    // The dashboard preview renders inside this site, so uploaded images load
    // from the page origin. Mobile previews pass an absolute base instead.
    imageBaseUrl: options.imageBaseUrl ?? "",
  });
  return { ok: true, data: email };
}

/**
 * Sends the broadcast. `clearDraft` removes the sender's saved draft for this
 * event in the same transaction; the dashboard composer passes it because its
 * editor is that draft. Other surfaces (the mobile API) leave the draft alone.
 */
export async function sendEventBroadcastForUser(
  actorUserId: string | null,
  input: unknown,
  options: { clearDraft?: boolean } = {},
): Promise<ActionResult<{ recipientCount: number; broadcastId: string }>> {
  const userId = actorUserId;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("broadcast", userId)) {
    return { ok: false, error: "Too many emails sent recently. Please wait before sending another broadcast." };
  }
  const parsed = sendEventBroadcastSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = flattenZodErrors(parsed.error);
    return { ok: false, error: fieldErrors.subject?.[0] ?? fieldErrors.body?.[0] ?? fieldErrors.statuses?.[0] ?? "Invalid input.", fieldErrors };
  }

  const context = await requireBroadcastContext(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return { ok: false, error: context.error };
  const body = cleanBody(parsed.data.body);
  if (!body.ok) return { ok: false, error: body.error };

  const audience = { statuses: parsed.data.statuses, attendance: parsed.data.attendance };
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Resolve inside the transaction so the stored count and the queued
      // rows describe exactly the same set of registrations.
      const recipients = await resolveBroadcastRecipients(tx, context.event.id, audience);
      if (recipients.length === 0) return null;
      const broadcast = await tx.eventBroadcast.create({
        data: {
          eventId: context.event.id,
          createdByUserId: userId,
          statuses: [...audience.statuses],
          attendance: audience.attendance,
          subject: parsed.data.subject,
          body: body.body,
          design: parsed.data.design,
          recipientCount: recipients.length,
        },
        select: { id: true },
      });
      await enqueueEventBroadcastRecipients(tx, recipients.map((recipient) => ({ to: recipient.email, broadcastId: broadcast.id, rsvpId: recipient.rsvpId })));
      if (options.clearDraft) await tx.eventBroadcastDraft.deleteMany({ where: { eventId: context.event.id, userId } });
      return { broadcastId: broadcast.id, recipientCount: recipients.length };
    });
    if (!result) return { ok: false, error: "No registrations match the selected audience." };

    startOutboxWorker();
    await recordAuditEvent({
      action: "EVENT_BROADCAST_QUEUED",
      actorUserId: userId,
      organisationId: context.org.id,
      targetType: "EventBroadcast",
      targetId: result.broadcastId,
      metadata: {
        eventId: context.event.id,
        recipientCount: result.recipientCount,
        statuses: audience.statuses.join(","),
        attendance: audience.attendance,
      },
    });
    revalidatePath(`/dashboard/${context.org.slug}/event/${context.event.id}`);
    return { ok: true, data: result };
  } catch {
    console.error("[event broadcast] queueing failed");
    return { ok: false, error: "Could not queue the email. Please try again." };
  }
}

export async function sendEventBroadcastTestForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ to: string }>> {
  const userId = actorUserId;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("broadcastTest", userId)) {
    return { ok: false, error: "Too many test emails. Please wait a little before sending another." };
  }
  const parsed = sendEventBroadcastTestSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = flattenZodErrors(parsed.error);
    return { ok: false, error: fieldErrors.subject?.[0] ?? fieldErrors.body?.[0] ?? "Invalid input.", fieldErrors };
  }

  const context = await requireBroadcastContext(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return { ok: false, error: context.error };
  const body = cleanBody(parsed.data.body);
  if (!body.ok) return { ok: false, error: body.error };

  // Test messages only ever go to the signed-in organiser's own verified inbox.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true, name: true } });
  if (!user?.email || !user.emailVerified) return { ok: false, error: "Verify your own email address before sending a test." };

  try {
    await enqueueEventBroadcastTest(prisma, {
      to: user.email,
      eventId: context.event.id,
      subject: parsed.data.subject,
      body: body.body,
      design: parsed.data.design,
      recipientName: user.name?.trim() || undefined,
    });
    startOutboxWorker();
    await recordAuditEvent({
      action: "EVENT_BROADCAST_TEST_SENT",
      actorUserId: userId,
      organisationId: context.org.id,
      targetType: "Event",
      targetId: context.event.id,
    });
    return { ok: true, data: { to: user.email } };
  } catch {
    console.error("[event broadcast] test queueing failed");
    return { ok: false, error: "Could not queue the test email. Please try again." };
  }
}

/*
 * Drafts: one private, autosaved composer state per organiser and event.
 * Access is exactly the composer's (requireBroadcastContext). Every query is
 * keyed by the signed-in user, so an organiser never reads or changes a
 * teammate's draft. Autosaves are not audited: a draft reaches nobody, holds
 * only what its author typed, and the send that uses it is audited.
 */

const draftSelect = { subject: true, body: true, design: true, statuses: true, attendance: true, templateId: true, updatedAt: true } as const;

function invalidDraftInput(error: ZodError) {
  const fieldErrors = flattenZodErrors(error);
  return { ok: false as const, error: fieldErrors.subject?.[0] ?? fieldErrors.body?.[0] ?? "Invalid draft.", fieldErrors };
}

/** The signed-in organiser's saved draft for the event, or null. Read-only, so not rate limited (like the recipient count). */
export async function loadEventBroadcastDraftForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ draft: EventBroadcastDraftDto | null }>> {
  const userId = actorUserId;
  if (!userId) return { ok: false, error: "You must be signed in." };
  const parsed = eventBroadcastDraftRefSchema.safeParse(input);
  if (!parsed.success) return invalidDraftInput(parsed.error);

  const context = await requireBroadcastContext(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return { ok: false, error: context.error };

  const row = await prisma.eventBroadcastDraft.findUnique({
    where: { eventId_userId: { eventId: context.event.id, userId } },
    select: draftSelect,
  });
  if (!row) return { ok: true, data: { draft: null } };
  return {
    ok: true,
    data: {
      draft: {
        subject: row.subject,
        body: row.body,
        design: isBroadcastDesign(row.design) ? row.design : DEFAULT_BROADCAST_DESIGN,
        statuses: row.statuses,
        attendance: row.attendance,
        templateId: row.templateId,
        updatedAt: row.updatedAt.toISOString(),
      },
    },
  };
}

/** Creates or replaces the organiser's draft. The body is sanitised exactly as on send. */
export async function saveEventBroadcastDraftForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ updatedAt: string }>> {
  const userId = actorUserId;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("broadcastDraft", userId)) {
    return { ok: false, error: "Saving too often. Your draft will be saved again in a moment." };
  }
  const parsed = saveEventBroadcastDraftSchema.safeParse(input);
  if (!parsed.success) return invalidDraftInput(parsed.error);

  const context = await requireBroadcastContext(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return { ok: false, error: context.error };

  const content = {
    subject: parsed.data.subject,
    body: sanitizeBroadcastHtml(parsed.data.body),
    design: parsed.data.design,
    statuses: parsed.data.statuses,
    attendance: parsed.data.attendance,
    templateId: parsed.data.templateId,
  };
  try {
    const saved = await prisma.eventBroadcastDraft.upsert({
      where: { eventId_userId: { eventId: context.event.id, userId } },
      create: { eventId: context.event.id, userId, ...content },
      update: content,
      select: { updatedAt: true },
    });
    return { ok: true, data: { updatedAt: saved.updatedAt.toISOString() } };
  } catch {
    console.error("[event broadcast] draft save failed");
    return { ok: false, error: "Could not save the draft. Please try again." };
  }
}

/** Deletes the organiser's own draft; discarding a draft that is already gone succeeds. */
export async function discardEventBroadcastDraftForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ discarded: boolean }>> {
  const userId = actorUserId;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("broadcastDraft", userId)) {
    return { ok: false, error: "Too many requests. Please wait a moment and try again." };
  }
  const parsed = eventBroadcastDraftRefSchema.safeParse(input);
  if (!parsed.success) return invalidDraftInput(parsed.error);

  const context = await requireBroadcastContext(userId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return { ok: false, error: context.error };

  const result = await prisma.eventBroadcastDraft.deleteMany({ where: { eventId: context.event.id, userId } });
  return { ok: true, data: { discarded: result.count > 0 } };
}
