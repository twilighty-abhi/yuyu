"use server";

import { Prisma, RsvpStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, getMembership } from "@/lib/permissions";
import { deleteRsvpSchema, manualRsvpSchema, restoreRsvpSchema, updateRsvpRegistrationSchema } from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";
import { recordAuditEvent } from "@/lib/audit";
import { submitManualGuestRsvpCore } from "@/lib/rsvpCore";
import { validateAndNormalizeAnswers } from "@/lib/rsvpCore";
import { isActionRateLimited } from "@/lib/actionRateLimit";

const UNDO_TTL_MS = 5 * 60_000;

export async function addManualRsvp(
  input: unknown,
): Promise<ActionResult<{ count: number; status: RsvpStatus }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("rsvp", session.user.id)) {
    return { ok: false, error: "Too many attendee additions. Please try again shortly." };
  }
  const parsed = manualRsvpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  const org = await prisma.organisation.findUnique({ where: { slug: parsed.data.organisationSlug } });
  if (!org) return { ok: false, error: "Organisation not found." };
  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) {
    return { ok: false, error: "You do not have permission to add attendees." };
  }

  const result = await submitManualGuestRsvpCore(parsed.data, { organisationId: org.id });
  if (!result.ok || !result.data) return result;

  await recordAuditEvent({
    action: "MANUAL_RSVP_CREATED",
    actorUserId: session.user.id,
    organisationId: org.id,
    targetType: "RSVP",
    targetId: result.data.rsvpId,
    metadata: { eventId: parsed.data.eventId, status: result.data.status },
  });
  revalidateRsvpPaths(org.slug, { eventId: parsed.data.eventId, eventInstanceId: null });
  revalidatePath(`/dashboard/${org.slug}/event/${parsed.data.eventId}/check-in`);
  return { ok: true, data: { count: result.data.count, status: result.data.status } };
}

export async function updateRsvpRegistration(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("rsvp", session.user.id)) {
    return { ok: false, error: "Too many attendee edits. Please try again shortly." };
  }
  const parsed = updateRsvpRegistrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };

  const org = await prisma.organisation.findUnique({ where: { slug: parsed.data.organisationSlug } });
  if (!org) return { ok: false, error: "Organisation not found." };
  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) return { ok: false, error: "You do not have permission to edit registrations." };

  const target = parsed.data.eventId
    ? { eventId: parsed.data.eventId, event: { organisationId: org.id } }
    : { eventInstanceId: parsed.data.eventInstanceId, eventInstance: { series: { organisationId: org.id } } };
  const rsvp = await prisma.rSVP.findFirst({
    where: { id: parsed.data.rsvpId, ...target },
    include: {
      user: { select: { id: true } },
      event: { select: { slug: true, registrationForm: { include: { fields: { orderBy: { sortOrder: "asc" } } } } } },
    },
  });
  if (!rsvp) return { ok: false, error: "RSVP not found." };

  const formFields = rsvp.event?.registrationForm?.fields ?? [];
  const validated = validateAndNormalizeAnswers({
    fields: formFields.map((field) => ({ ...field, options: field.options })),
    answers: parsed.data.answers as Record<string, unknown>,
  });
  if ("error" in validated) return { ok: false, error: validated.error };

  const guestUpdate = rsvp.userId ? {} : {
    guestName: parsed.data.name?.trim() || rsvp.guestName,
    guestEmail: parsed.data.guestEmail?.trim().toLowerCase() || rsvp.guestEmail,
  };
  const guestEmail = "guestEmail" in guestUpdate ? guestUpdate.guestEmail : rsvp.guestEmail;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.rSVP.update({
        where: { id: rsvp.id },
        data: {
          ...guestUpdate,
          ...(rsvp.userId ? {} : { attendeeKey: `guest:${guestEmail}` }),
        },
      });
      await tx.rsvpAnswer.deleteMany({ where: { rsvpId: rsvp.id } });
      if (validated.rows.length > 0) {
        await tx.rsvpAnswer.createMany({
          data: validated.rows.map((row) => ({
            rsvpId: rsvp.id,
            fieldId: row.fieldId,
            valueText: row.valueText ?? null,
            valueBool: row.valueBool ?? null,
            valueNumber: row.valueNumber ?? null,
            valueDate: row.valueDate ?? null,
          })),
        });
      }
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return { ok: false, error: "This email is already registered for this event." };
    }
    console.error("[rsvp] registration update failed", error);
    return { ok: false, error: "Could not update the registration." };
  }

  await recordAuditEvent({ action: "RSVP_REGISTRATION_UPDATED", actorUserId: session.user.id, organisationId: org.id, targetType: "RSVP", targetId: rsvp.id });
  revalidateRsvpPaths(org.slug, { eventId: rsvp.eventId, eventInstanceId: rsvp.eventInstanceId, eventSlug: rsvp.event?.slug });
  return { ok: true };
}

const snapshotSchema = z.object({
  eventId: z.string().min(1).nullable(),
  eventInstanceId: z.string().min(1).nullable(),
  userId: z.string().min(1).nullable(),
  guestEmail: z.string().email().nullable(),
  guestName: z.string().max(200).nullable(),
  status: z.nativeEnum(RsvpStatus),
  attendeeKey: z.string().min(1).max(512),
  checkInToken: z.string().min(8).max(256),
  checkedInAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  answers: z.array(z.object({
    fieldId: z.string().min(1),
    valueText: z.string().nullable(),
    valueBool: z.boolean().nullable(),
    valueNumber: z.number().finite().nullable(),
    valueDate: z.string().datetime().nullable(),
  })).max(200),
}).refine(
  (value) => Boolean(value.eventId) !== Boolean(value.eventInstanceId),
  { message: "Invalid RSVP target." },
);

function revalidateRsvpPaths(orgSlug: string, target: { eventId: string | null; eventInstanceId: string | null; eventSlug?: string }) {
  revalidatePath(`/${orgSlug}`);
  revalidatePath(`/dashboard/${orgSlug}`);
  if (target.eventId) {
    revalidatePath(`/dashboard/${orgSlug}/event/${target.eventId}`);
    if (target.eventSlug) revalidatePath(`/${orgSlug}/${target.eventSlug}`);
  }
  if (target.eventInstanceId) revalidatePath(`/${orgSlug}/i/${target.eventInstanceId}`);
}

export async function deleteRsvp(input: unknown): Promise<ActionResult<{ undoId: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };

  const parsed = deleteRsvpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  const { organisationSlug, eventId, eventInstanceId, rsvpId } = parsed.data;
  const org = await prisma.organisation.findUnique({ where: { slug: organisationSlug } });
  if (!org) return { ok: false, error: "Organisation not found." };
  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) return { ok: false, error: "You do not have permission to manage attendees." };

  const rsvp = await prisma.rSVP.findFirst({
    where: {
      id: rsvpId,
      ...(eventId ? { eventId, event: { organisationId: org.id } } : { eventInstanceId, eventInstance: { series: { organisationId: org.id } } }),
    },
    include: {
      answers: true,
      event: { select: { slug: true } },
    },
  });
  if (!rsvp) return { ok: false, error: "RSVP not found." };

  const snapshot = {
    eventId: rsvp.eventId,
    eventInstanceId: rsvp.eventInstanceId,
    userId: rsvp.userId,
    guestEmail: rsvp.guestEmail,
    guestName: rsvp.guestName,
    status: rsvp.status,
    attendeeKey: rsvp.attendeeKey,
    checkInToken: rsvp.checkInToken,
    checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
    createdAt: rsvp.createdAt.toISOString(),
    answers: rsvp.answers.map((answer) => ({
      fieldId: answer.fieldId,
      valueText: answer.valueText,
      valueBool: answer.valueBool,
      valueNumber: answer.valueNumber,
      valueDate: answer.valueDate?.toISOString() ?? null,
    })),
  };

  const undo = await prisma.$transaction(async (tx) => {
    // Keep the short-lived undo table bounded even when no scheduled cleanup is
    // configured. Expired snapshots are never eligible for restoration.
    await tx.rsvpDeletionUndo.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const created = await tx.rsvpDeletionUndo.create({
      data: {
        organisationId: org.id,
        deletedByUserId: session.user.id,
        payload: snapshot as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + UNDO_TTL_MS),
      },
      select: { id: true },
    });
    await tx.rSVP.delete({ where: { id: rsvp.id } });
    return created;
  });

  await recordAuditEvent({ action: "RSVP_DELETED", actorUserId: session.user.id, organisationId: org.id, targetType: "RSVP", targetId: rsvp.id });

  revalidateRsvpPaths(org.slug, { eventId: rsvp.eventId, eventInstanceId: rsvp.eventInstanceId, eventSlug: rsvp.event?.slug });
  return { ok: true, data: { undoId: undo.id } };
}

/** Restore only a short-lived snapshot created by this server for this organiser. */
export async function restoreRsvp(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  const parsed = restoreRsvpSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid restore request." };

  const org = await prisma.organisation.findUnique({ where: { slug: parsed.data.organisationSlug } });
  if (!org) return { ok: false, error: "Organisation not found." };
  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) return { ok: false, error: "You do not have permission to restore RSVPs." };

  const undo = await prisma.rsvpDeletionUndo.findFirst({
    where: {
      id: parsed.data.undoId,
      organisationId: org.id,
      deletedByUserId: session.user.id,
      expiresAt: { gt: new Date() },
    },
  });
  if (!undo) return { ok: false, error: "This undo has expired or is unavailable." };
  const snapshot = snapshotSchema.safeParse(undo.payload);
  if (!snapshot.success) return { ok: false, error: "Could not restore this RSVP safely." };

  const targetExists = snapshot.data.eventId
    ? await prisma.event.findFirst({ where: { id: snapshot.data.eventId, organisationId: org.id }, select: { id: true, slug: true } })
    : await prisma.eventInstance.findFirst({ where: { id: snapshot.data.eventInstanceId!, series: { organisationId: org.id } }, select: { id: true } });
  if (!targetExists) return { ok: false, error: "The original event no longer exists." };

  let restoredId: string;
  try {
    const restored = await prisma.$transaction(async (tx) => {
      const created = await tx.rSVP.create({
        data: {
          eventId: snapshot.data.eventId,
          eventInstanceId: snapshot.data.eventInstanceId,
          userId: snapshot.data.userId,
          guestEmail: snapshot.data.guestEmail,
          guestName: snapshot.data.guestName,
          status: snapshot.data.status,
          attendeeKey: snapshot.data.attendeeKey,
          checkInToken: snapshot.data.checkInToken,
          checkedInAt: snapshot.data.checkedInAt ? new Date(snapshot.data.checkedInAt) : null,
          createdAt: new Date(snapshot.data.createdAt),
          answers: { create: snapshot.data.answers.map((answer) => ({
            fieldId: answer.fieldId,
            valueText: answer.valueText,
            valueBool: answer.valueBool,
            valueNumber: answer.valueNumber,
            valueDate: answer.valueDate ? new Date(answer.valueDate) : null,
          })) },
        },
      });
      await tx.rsvpDeletionUndo.delete({ where: { id: undo.id } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    restoredId = restored.id;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return { ok: false, error: "This RSVP can no longer be restored because a conflicting registration exists." };
    }
    console.error("[rsvp] restore failed", error);
    return { ok: false, error: "Could not restore the RSVP." };
  }

  const eventSlug = snapshot.data.eventId && "slug" in targetExists
    ? String(targetExists.slug)
    : undefined;
  revalidateRsvpPaths(org.slug, {
    eventId: snapshot.data.eventId,
    eventInstanceId: snapshot.data.eventInstanceId,
    eventSlug,
  });
  await recordAuditEvent({ action: "RSVP_RESTORED", actorUserId: session.user.id, organisationId: org.id, targetType: "RSVP", targetId: restoredId });
  return { ok: true };
}
