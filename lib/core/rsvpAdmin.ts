import "server-only";

import { Prisma, RegistrationMode, RsvpStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { canManageEvents, getMembership } from "@/lib/permissions";
import { deleteRsvpSchema, manualRsvpSchema, restoreRsvpSchema, updateRsvpRegistrationSchema } from "@/lib/validators";
import type { ActionResult } from "@/app/actions/org";
import { flattenZodErrors } from "@/app/actions/utils";
import { recordAuditEvent } from "@/lib/audit";
import { submitManualGuestRsvpCore } from "@/lib/rsvpCore";
import { validateAndNormalizeAnswers } from "@/lib/rsvpCore";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { hasCapacityToRestoreConfirmedRsvp } from "@/lib/rsvpCapacity";
import { promoteOldestWaitlistedUnit, settleTeamAfterMemberLeft } from "@/lib/teamUnits";
import { isTeamDeletionSnapshot, restoreTeamDeletionSnapshot, soleMemberTeamSnapshotTx } from "@/lib/core/teams";
import { captureSubmissionSnapshotTx, restoreSubmissionSnapshotTx, submissionSnapshotSchema, type SubmissionSnapshot } from "@/lib/core/submissionLifecycle";

const UNDO_TTL_MS = 5 * 60_000;

export async function addManualRsvpForUser(
  actorUserId: string | null,
  input: unknown,
): Promise<ActionResult<{ count: number; status: RsvpStatus; rsvpId: string }>> {
  if (!actorUserId) return { ok: false, error: "You must be signed in." };
  const session = { user: { id: actorUserId } };
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
  return { ok: true, data: { count: result.data.count, status: result.data.status, rsvpId: result.data.rsvpId } };
}

export async function updateRsvpRegistrationForUser(actorUserId: string | null, input: unknown): Promise<ActionResult> {
  if (!actorUserId) return { ok: false, error: "You must be signed in." };
  const session = { user: { id: actorUserId } };
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
    console.error("[rsvp] registration update failed");
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
  /** Team the RSVP belonged to (TEAM events); restored into it only if it still exists with room. */
  teamId: z.string().min(1).max(128).nullable().optional(),
  answers: z.array(z.object({
    fieldId: z.string().min(1),
    valueText: z.string().nullable(),
    valueBool: z.boolean().nullable(),
    valueNumber: z.number().finite().nullable(),
    valueDate: z.string().datetime().nullable(),
  })).max(200),
  /** A solo registrant's project and its judging record (docs/HACKATHON.md), recreated on undo. */
  submission: submissionSnapshotSchema.nullable().optional(),
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

export async function deleteRsvpForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ undoId: string }>> {
  if (!actorUserId) return { ok: false, error: "You must be signed in." };
  const session = { user: { id: actorUserId } };
  if (await isActionRateLimited("rsvp", session.user.id)) return { ok: false, error: "Too many attendee updates. Try again shortly." };

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
      event: { select: { slug: true, registrationMode: true } },
    },
  });
  if (!rsvp) return { ok: false, error: "RSVP not found." };
  const teamEvent = rsvp.eventId && rsvp.event?.registrationMode === RegistrationMode.TEAM ? rsvp.eventId : null;

  const snapshot: Record<string, unknown> & { teamId?: string | null; submission?: SubmissionSnapshot | null } = {
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
    ...(teamEvent ? { teamId: rsvp.teamId } : {}),
    answers: rsvp.answers.map((answer) => ({
      fieldId: answer.fieldId,
      valueText: answer.valueText,
      valueBool: answer.valueBool,
      valueNumber: answer.valueNumber,
      valueDate: answer.valueDate?.toISOString() ?? null,
    })),
  };

  const undo = await prisma.$transaction(async (tx) => {
    // TEAM events: take the shared Event lock and re-read the team under it,
    // so leadership passes on or an emptied team is deleted (freeing its unit).
    let teamId: string | null = null;
    let payload: Prisma.InputJsonValue = snapshot as Prisma.InputJsonValue;
    if (teamEvent) {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${teamEvent} FOR UPDATE`;
      const current = await tx.rSVP.findUnique({ where: { id: rsvp.id }, select: { teamId: true } });
      teamId = current?.teamId ?? null;
      snapshot.teamId = teamId;
      // The last member's delete also deletes the emptied team, so a member
      // snapshot could never be restored into it. Keep the whole team instead.
      const teamSnapshot = teamId ? await soleMemberTeamSnapshotTx(tx, { teamId, eventId: teamEvent, rsvpId: rsvp.id }) : null;
      if (teamSnapshot) payload = teamSnapshot as Prisma.InputJsonValue;
    } else if (rsvp.eventId) {
      // Same lock order as entrant submission writes (Event, then RSVP).
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${rsvp.eventId} FOR UPDATE`;
    }
    // A solo registration's project (and its scores) cascades with the RSVP;
    // keep it in the undo snapshot so restoring brings it back.
    if (rsvp.eventId && !teamId) {
      snapshot.submission = await captureSubmissionSnapshotTx(tx, { eventId: rsvp.eventId, rsvpId: rsvp.id });
      payload = snapshot as Prisma.InputJsonValue;
    }
    // Keep the short-lived undo table bounded even when no scheduled cleanup is
    // configured. Expired snapshots are never eligible for restoration.
    await tx.rsvpDeletionUndo.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const created = await tx.rsvpDeletionUndo.create({
      data: {
        organisationId: org.id,
        deletedByUserId: session.user.id,
        payload,
        expiresAt: new Date(Date.now() + UNDO_TTL_MS),
      },
      select: { id: true },
    });
    await tx.rSVP.delete({ where: { id: rsvp.id } });
    if (teamEvent && teamId) {
      const settled = await settleTeamAfterMemberLeft(tx, { teamId, eventId: teamEvent, leftRsvpId: rsvp.id });
      if (settled.freedConfirmedUnit) {
        const event = await tx.event.findUnique({ where: { id: teamEvent }, select: { id: true, title: true, capacity: true, privacyType: true } });
        if (event) await promoteOldestWaitlistedUnit(tx, event);
      }
    }
    return created;
  });

  await recordAuditEvent({ action: "RSVP_DELETED", actorUserId: session.user.id, organisationId: org.id, targetType: "RSVP", targetId: rsvp.id });

  revalidateRsvpPaths(org.slug, { eventId: rsvp.eventId, eventInstanceId: rsvp.eventInstanceId, eventSlug: rsvp.event?.slug });
  return { ok: true, data: { undoId: undo.id } };
}

/** Restore only a short-lived snapshot created by this server for this organiser. */
export async function restoreRsvpForUser(actorUserId: string | null, input: unknown): Promise<ActionResult> {
  if (!actorUserId) return { ok: false, error: "You must be signed in." };
  const session = { user: { id: actorUserId } };
  if (await isActionRateLimited("rsvp", session.user.id)) return { ok: false, error: "Too many attendee updates. Try again shortly." };
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
  if (isTeamDeletionSnapshot(undo.payload)) {
    const restoredTeam = await restoreTeamDeletionSnapshot(undo, org.id);
    if (!restoredTeam.ok || !restoredTeam.data) return restoredTeam.ok ? { ok: false, error: "Could not restore the team." } : restoredTeam;
    revalidateRsvpPaths(org.slug, { eventId: restoredTeam.data.eventId, eventInstanceId: null, eventSlug: restoredTeam.data.eventSlug });
    await recordAuditEvent({ action: "TEAM_RESTORED", actorUserId: session.user.id, organisationId: org.id, targetType: "Team", targetId: restoredTeam.data.teamId });
    return { ok: true };
  }
  const snapshot = snapshotSchema.safeParse(undo.payload);
  if (!snapshot.success) return { ok: false, error: "Could not restore this RSVP safely." };

  const targetExists = snapshot.data.eventId
    ? await prisma.event.findFirst({ where: { id: snapshot.data.eventId, organisationId: org.id }, select: { id: true, slug: true } })
    : await prisma.eventInstance.findFirst({ where: { id: snapshot.data.eventInstanceId!, series: { organisationId: org.id } }, select: { id: true } });
  if (!targetExists) return { ok: false, error: "The original event no longer exists." };

  let restoredId: string;
  let refusal = "This RSVP cannot be restored because the event is now at capacity.";
  try {
    const restored = await prisma.$transaction(async (tx) => {
      let status = snapshot.data.status;
      let teamId: string | null = null;
      if (snapshot.data.teamId && snapshot.data.eventId) {
        // A team member goes back into their team (taking its current status)
        // only if it still exists with room; joining never uses a unit.
        await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${snapshot.data.eventId} FOR UPDATE`;
        const team = await tx.team.findFirst({
          where: { id: snapshot.data.teamId, eventId: snapshot.data.eventId },
          select: { id: true, status: true, _count: { select: { members: true } }, event: { select: { teamMaxSize: true } } },
        });
        if (!team || team.status === RsvpStatus.REJECTED || team.event.teamMaxSize == null || team._count.members >= team.event.teamMaxSize) {
          refusal = "This RSVP cannot be restored because its team no longer exists or is full.";
          return null;
        }
        status = team.status;
        teamId = team.id;
      } else if (snapshot.data.status === RsvpStatus.CONFIRMED) {
        const target = snapshot.data.eventId ? { eventId: snapshot.data.eventId } : { eventInstanceId: snapshot.data.eventInstanceId! };
        if (!(await hasCapacityToRestoreConfirmedRsvp(tx, target))) return null;
      }
      const created = await tx.rSVP.create({
        data: {
          eventId: snapshot.data.eventId,
          eventInstanceId: snapshot.data.eventInstanceId,
          userId: snapshot.data.userId,
          guestEmail: snapshot.data.guestEmail,
          guestName: snapshot.data.guestName,
          status,
          ...(teamId ? { teamId } : {}),
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
      if (snapshot.data.submission && snapshot.data.eventId && !teamId) {
        await restoreSubmissionSnapshotTx(tx, snapshot.data.submission, { eventId: snapshot.data.eventId, rsvpId: created.id });
      }
      await tx.rsvpDeletionUndo.delete({ where: { id: undo.id } });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!restored) return { ok: false, error: refusal };
    restoredId = restored.id;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      return { ok: false, error: "This RSVP can no longer be restored because a conflicting registration exists." };
    }
    console.error("[rsvp] restore failed");
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
