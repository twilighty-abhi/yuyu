"use server";

import { EventPermission } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMembership, isOrgAdmin } from "@/lib/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { createEventCollaboratorToken, hashEventCollaboratorToken } from "@/lib/eventCollaboratorToken";
import { enqueueCollaboratorInvite } from "@/lib/outbox";
import { getRequestOrigin } from "@/lib/publicUrl";
import { startOutboxWorker } from "@/lib/outboxWorker";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import type { ActionResult } from "./org";

const permissions = z
  .array(z.nativeEnum(EventPermission))
  .min(1)
  .max(Object.keys(EventPermission).length)
  .refine((values) => new Set(values).size === values.length, "Each permission can be granted once.");
const targetFields = z.object({ organisationSlug: z.string().min(1), eventId: z.string().min(1).optional(), eventSeriesId: z.string().min(1).optional() });
const target = targetFields.refine((v) => Boolean(v.eventId) !== Boolean(v.eventSeriesId));
/** Judging is one-off-event only (docs/HACKATHON.md): a series grant can never carry JUDGE. */
const judgeOnlyOnEvents = (v: { eventSeriesId?: string; permissions: EventPermission[] }) => !(v.eventSeriesId && v.permissions.includes(EventPermission.JUDGE));
const inviteSchema = targetFields
  .extend({ email: z.string().trim().email(), permissions })
  .refine((v) => Boolean(v.eventId) !== Boolean(v.eventSeriesId))
  .refine(judgeOnlyOnEvents);


async function requireAdmin(orgSlug: string, userId: string) {
  const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;
  const membership = await getMembership(userId, org.id);
  return membership && isOrgAdmin(membership.role) ? org : null;
}

export async function createEventCollaboratorInvite(input: unknown): Promise<ActionResult<{ token: string; inviteId: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("invite", session.user.id)) return { ok: false, error: "Too many invite requests. Please try again later." };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid collaborator invite." };
  const org = await requireAdmin(parsed.data.organisationSlug, session.user.id);
  if (!org) return { ok: false, error: "You do not have permission to invite collaborators." };
  const exists = parsed.data.eventId
    ? await prisma.event.findFirst({ where: { id: parsed.data.eventId, organisationId: org.id }, select: { id: true, title: true } })
    : await prisma.eventSeries.findFirst({ where: { id: parsed.data.eventSeriesId, organisationId: org.id }, select: { id: true, title: true } });
  if (!exists) return { ok: false, error: "Event not found." };
  const token = createEventCollaboratorToken();
  const origin = await getRequestOrigin();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  const invite = await prisma.$transaction(async (tx) => {
    const created = await tx.eventCollaboratorInvite.create({ data: {
    ...(parsed.data.eventId ? { eventId: parsed.data.eventId } : { eventSeriesId: parsed.data.eventSeriesId }),
    email: parsed.data.email.toLowerCase(), tokenHash: hashEventCollaboratorToken(token), permissions: parsed.data.permissions,
    createdByUserId: session.user.id, expiresAt,
    } });
    await enqueueCollaboratorInvite(tx, { to: parsed.data.email.toLowerCase(), eventTitle: exists.title, inviteUrl: `${origin}/join/event-collaborator/${token}`, expiresAt: expiresAt.toISOString() });
    return created;
  });
  await recordAuditEvent({ action: "EVENT_COLLABORATOR_INVITED", actorUserId: session.user.id, organisationId: org.id, targetType: "EventCollaboratorInvite", targetId: invite.id });
  startOutboxWorker();
  revalidatePath(`/dashboard/${org.slug}`);
  if (parsed.data.eventId) revalidatePath(`/dashboard/${org.slug}/event/${parsed.data.eventId}`);
  revalidatePath("/dashboard");
  return { ok: true, data: { token, inviteId: invite.id } };
}

export async function revokeEventCollaborator(input: unknown): Promise<ActionResult> {
  const session = await auth();
  const parsed = target.extend({ collaboratorId: z.string().min(1) }).safeParse(input);
  if (!session?.user?.id || !parsed.success) return { ok: false, error: "Invalid request." };
  const org = await requireAdmin(parsed.data.organisationSlug, session.user.id);
  if (!org) return { ok: false, error: "You do not have permission." };
  const deleted = await prisma.eventCollaborator.deleteMany({
    where: {
      id: parsed.data.collaboratorId,
      ...(parsed.data.eventId
        ? { eventId: parsed.data.eventId, event: { organisationId: org.id } }
        : { eventSeriesId: parsed.data.eventSeriesId, series: { organisationId: org.id } }),
    },
  });
  if (!deleted.count) return { ok: false, error: "Collaborator not found." };
  await recordAuditEvent({ action: "EVENT_COLLABORATOR_REVOKED", actorUserId: session.user.id, organisationId: org.id, targetType: "EventCollaborator", targetId: parsed.data.collaboratorId });
  if (parsed.data.eventId) revalidatePath(`/dashboard/${org.slug}/event/${parsed.data.eventId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateEventCollaboratorPermissions(input: unknown): Promise<ActionResult> {
  const session = await auth();
  const parsed = targetFields.extend({ collaboratorId: z.string().min(1), permissions }).refine((v) => Boolean(v.eventId) !== Boolean(v.eventSeriesId)).refine(judgeOnlyOnEvents).safeParse(input);
  if (!session?.user?.id || !parsed.success) return { ok: false, error: "Invalid collaborator permissions." };
  const org = await requireAdmin(parsed.data.organisationSlug, session.user.id);
  if (!org) return { ok: false, error: "You do not have permission." };
  const updated = await prisma.eventCollaborator.updateMany({
    where: {
      id: parsed.data.collaboratorId,
      ...(parsed.data.eventId
        ? { eventId: parsed.data.eventId, event: { organisationId: org.id } }
        : { eventSeriesId: parsed.data.eventSeriesId, series: { organisationId: org.id } }),
    },
    data: { permissions: parsed.data.permissions },
  });
  if (!updated.count) return { ok: false, error: "Collaborator not found." };
  await recordAuditEvent({ action: "EVENT_COLLABORATOR_PERMISSIONS_UPDATED", actorUserId: session.user.id, organisationId: org.id, targetType: "EventCollaborator", targetId: parsed.data.collaboratorId, metadata: { permissions: parsed.data.permissions.join(",") } });
  if (parsed.data.eventId) revalidatePath(`/dashboard/${org.slug}/event/${parsed.data.eventId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Cancels a pending (unused) co-organiser invite so its emailed link stops working. Organisation admins only. */
export async function cancelEventCollaboratorInvite(input: unknown): Promise<ActionResult> {
  const session = await auth();
  const parsed = target.extend({ inviteId: z.string().min(1) }).safeParse(input);
  if (!session?.user?.id || !parsed.success) return { ok: false, error: "Invalid request." };
  if (await isActionRateLimited("invite", session.user.id)) return { ok: false, error: "Too many invite requests. Please try again later." };
  const org = await requireAdmin(parsed.data.organisationSlug, session.user.id);
  if (!org) return { ok: false, error: "You do not have permission." };
  const deleted = await prisma.eventCollaboratorInvite.deleteMany({
    where: {
      id: parsed.data.inviteId,
      usedAt: null,
      ...(parsed.data.eventId
        ? { eventId: parsed.data.eventId, event: { organisationId: org.id } }
        : { eventSeriesId: parsed.data.eventSeriesId, series: { organisationId: org.id } }),
    },
  });
  if (!deleted.count) return { ok: false, error: "Invite not found or already accepted." };
  await recordAuditEvent({ action: "EVENT_COLLABORATOR_INVITE_CANCELLED", actorUserId: session.user.id, organisationId: org.id, targetType: "EventCollaboratorInvite", targetId: parsed.data.inviteId });
  if (parsed.data.eventId) revalidatePath(`/dashboard/${org.slug}/event/${parsed.data.eventId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
