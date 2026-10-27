import "server-only";

import { revalidatePath } from "next/cache";
import { AttendanceResponse, EventStatus, Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sqlUtcTimestamp } from "@/lib/sqlTimestamp";
import { canManageEvents, getMembership } from "@/lib/permissions";
import { attendanceCheckRefSchema, attendanceCheckSettingsSchema, attendanceLinkSchema, attendanceReplySchema } from "@/lib/validators";
import type { ActionResult } from "@/app/actions/org";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { enqueueAttendanceChecks, type AttendanceCheckPayload } from "@/lib/outbox";
import { startOutboxWorker } from "@/lib/outboxWorker";
import { attendancePath, generateAttendanceToken, hashAttendanceToken, isAttendanceTokenShape } from "@/lib/attendanceToken";
import {
  ATTENDANCE_REMINDER_INTERVAL_MS,
  attendanceCheckOpen,
  isAttendanceCheckRecipient,
  attendanceReplyClosedReason,
  type AttendanceReplyClosed,
  type AttendanceResponseValue,
  type AttendanceSummary,
} from "@/lib/attendanceCheck";
import { cancelRsvpForUser } from "@/lib/core/rsvpCancel";

/*
 * Attendance confirmation ("Are you still coming?", docs/FEATURES.md).
 *
 * MANUAL ONLY: nothing in this file runs on a timer, and the outbox worker
 * never creates an AttendanceCheck. Every email is queued by an explicit
 * organiser action (send, or remind people who have not replied), with the
 * exact permission of the Emails tab's broadcasts: organisation OWNER/ADMIN
 * (`canManageEvents`, as in lib/core/broadcasts.ts). No collaborator grant
 * covers emailing guests.
 *
 * Recipients are CONFIRMED registrations of this one-off event, one email per
 * person (each team member individually). The unique `rsvpId` plus the Event
 * row lock make a send idempotent: clicking twice, or two organisers at once,
 * never asks anyone twice.
 */

/** Audit actions; the Emails card reads the latest send and the release count from them. */
export const ATTENDANCE_AUDIT = {
  sent: "ATTENDANCE_CHECK_SENT",
  reminded: "ATTENDANCE_CHECK_REMINDED",
  settings: "ATTENDANCE_CHECK_SETTINGS_UPDATED",
  released: "ATTENDANCE_CHECK_RELEASED",
  linkShared: "ATTENDANCE_CHECK_LINK_SHARED",
} as const;

type Context =
  | { ok: false; error: string }
  | {
      ok: true;
      org: { id: string; slug: string };
      event: { id: string; title: string; status: EventStatus; startDateTime: Date; attendanceCheckReleaseOnDecline: boolean };
    };

const SEND_PERMISSION_ERROR = "You do not have permission to email attendees.";
const CANCELLED_ERROR = "This event is cancelled, so guests cannot be asked.";

/** The broadcast composer's access rule, exactly: organisation owners and admins of the event's organisation. */
async function requireAttendanceContext(userId: string, organisationSlug: string, eventId: string): Promise<Context> {
  const org = await prisma.organisation.findUnique({ where: { slug: organisationSlug }, select: { id: true, slug: true } });
  if (!org) return { ok: false, error: "Organisation not found." };
  const membership = await getMembership(userId, org.id);
  if (!canManageEvents(membership)) return { ok: false, error: SEND_PERMISSION_ERROR };
  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: org.id },
    select: { id: true, title: true, status: true, startDateTime: true, attendanceCheckReleaseOnDecline: true },
  });
  if (!event) return { ok: false, error: "Event not found." };
  return { ok: true, org, event };
}

/** CONFIRMED attendee registrations of the event that have not been asked yet. Crew (docs/CREW.md) run the event and are never asked. */
function unaskedWhere(eventId: string): Prisma.RSVPWhereInput {
  return { eventId, status: RsvpStatus.CONFIRMED, isCrew: false, attendanceCheck: { is: null } };
}

/** Not-replied checks of still-confirmed guests whose last email is at least 12 hours old. */
function remindableWhere(eventId: string, now: Date): Prisma.AttendanceCheckWhereInput {
  return {
    eventId,
    response: null,
    sentAt: { lte: new Date(now.getTime() - ATTENDANCE_REMINDER_INTERVAL_MS) },
    rsvp: { status: RsvpStatus.CONFIRMED, isCrew: false },
  };
}

export type AttendanceCheckStatus = AttendanceSummary & {
  releaseOnDecline: boolean;
  lastSent: { at: string; byName: string | null; recipientCount: number | null } | null;
};

/**
 * Counts for the Emails card, the Overview line and the Guests chips. Callers
 * have already authorised the viewer for the event. Names only, never emails.
 */
export async function loadAttendanceCheckStatus(event: { id: string; organisationId: string; attendanceCheckReleaseOnDecline: boolean }, now: Date = new Date()): Promise<AttendanceCheckStatus> {
  const [coming, notComing, noReply, notAsked, remindable, released, last] = await Promise.all([
    prisma.attendanceCheck.count({ where: { eventId: event.id, response: AttendanceResponse.ATTENDING } }),
    prisma.attendanceCheck.count({ where: { eventId: event.id, response: AttendanceResponse.NOT_ATTENDING } }),
    prisma.attendanceCheck.count({ where: { eventId: event.id, response: null, rsvp: { status: RsvpStatus.CONFIRMED, isCrew: false } } }),
    prisma.rSVP.count({ where: unaskedWhere(event.id) }),
    prisma.attendanceCheck.count({ where: remindableWhere(event.id, now) }),
    prisma.auditEvent.count({ where: { organisationId: event.organisationId, action: ATTENDANCE_AUDIT.released, targetType: "Event", targetId: event.id } }),
    prisma.auditEvent.findFirst({
      where: { organisationId: event.organisationId, action: { in: [ATTENDANCE_AUDIT.sent, ATTENDANCE_AUDIT.reminded] }, targetType: "Event", targetId: event.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, metadata: true, actor: { select: { name: true } } },
    }),
  ]);
  const metadata = last?.metadata && typeof last.metadata === "object" && !Array.isArray(last.metadata) ? (last.metadata as Record<string, unknown>) : null;
  return {
    asked: coming + notComing + noReply,
    coming,
    notComing,
    noReply,
    notAsked,
    remindable,
    released,
    releaseOnDecline: event.attendanceCheckReleaseOnDecline,
    lastSent: last
      ? {
          at: last.createdAt.toISOString(),
          byName: last.actor?.name?.trim() || null,
          recipientCount: typeof metadata?.recipientCount === "number" ? metadata.recipientCount : null,
        }
      : null,
  };
}

/** The confirmation step: how many guests a send would ask right now. Read-only. */
export async function previewAttendanceCheckSendForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ count: number; firstSend: boolean; eventStart: string }>> {
  if (!actorUserId) return { ok: false, error: "You must be signed in." };
  const parsed = attendanceCheckRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const context = await requireAttendanceContext(actorUserId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return context;
  if (context.event.status === EventStatus.CANCELLED) return { ok: false, error: CANCELLED_ERROR };
  if (!attendanceCheckOpen(context.event.startDateTime)) return { ok: false, error: "This event has started, so guests can no longer be asked." };
  const [count, asked] = await Promise.all([
    prisma.rSVP.count({ where: unaskedWhere(context.event.id) }),
    prisma.attendanceCheck.count({ where: { eventId: context.event.id } }),
  ]);
  return { ok: true, data: { count, firstSend: asked === 0, eventStart: context.event.startDateTime.toISOString() } };
}

function recipientEmail(rsvp: { guestEmail: string | null; user: { email: string | null } | null }): string | null {
  const email = (rsvp.user?.email ?? rsvp.guestEmail ?? "").trim();
  return email || null;
}

/**
 * Ask every CONFIRMED guest who has not been asked yet. Safe to repeat: the
 * Event row lock serialises concurrent sends and the unique `rsvpId` skips
 * anyone already asked, so a second click (or a second organiser) asks only
 * people confirmed since. Allowed until the event starts.
 */
export async function sendAttendanceChecksForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ queued: number }>> {
  if (!actorUserId) return { ok: false, error: "You must be signed in." };
  const parsed = attendanceCheckRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (await isActionRateLimited("attendanceCheckSend", actorUserId)) {
    return { ok: false, error: "Too many attendance emails sent recently. Please wait before sending again." };
  }
  const context = await requireAttendanceContext(actorUserId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return context;
  const eventId = context.event.id;

  let result: { queued: number; firstSend: boolean } | { error: string };
  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
      // Re-read under the lock: the start time is the deadline.
      const locked = await tx.event.findUnique({ where: { id: eventId }, select: { startDateTime: true, status: true } });
      if (locked?.status === EventStatus.CANCELLED) return { error: CANCELLED_ERROR };
      if (!locked || !attendanceCheckOpen(locked.startDateTime)) return { error: "This event has started, so guests can no longer be asked." };
      const firstSend = (await tx.attendanceCheck.count({ where: { eventId } })) === 0;
      const rsvps = await tx.rSVP.findMany({
        where: unaskedWhere(eventId),
        select: { id: true, guestEmail: true, user: { select: { email: true } } },
        orderBy: { createdAt: "asc" },
      });
      const sentAt = new Date();
      const planned = rsvps.flatMap((rsvp) => {
        const to = recipientEmail(rsvp);
        if (!to) return [];
        const token = generateAttendanceToken();
        return [{ rsvpId: rsvp.id, to, token }];
      });
      if (planned.length === 0) return { queued: 0, firstSend };
      // ON CONFLICT DO NOTHING: a registration is only ever asked once.
      await tx.attendanceCheck.createMany({
        data: planned.map((row) => ({ rsvpId: row.rsvpId, eventId, tokenHash: row.token.hash, sentAt })),
        skipDuplicates: true,
      });
      // Only rows this call inserted get an email (their digest is ours).
      const inserted = await tx.attendanceCheck.findMany({
        where: { tokenHash: { in: planned.map((row) => row.token.hash) } },
        select: { rsvpId: true },
      });
      const insertedIds = new Set(inserted.map((row) => row.rsvpId));
      const payloads: AttendanceCheckPayload[] = planned
        .filter((row) => insertedIds.has(row.rsvpId))
        .map((row) => ({ to: row.to, rsvpId: row.rsvpId, token: row.token.raw }));
      await enqueueAttendanceChecks(tx, payloads);
      return { queued: payloads.length, firstSend };
    }, { timeout: 60_000 });
  } catch {
    console.error("[attendance check] queueing failed");
    return { ok: false, error: "Could not queue the emails. Please try again." };
  }
  if ("error" in result) return { ok: false, error: result.error };
  if (result.queued === 0) return { ok: false, error: "Every confirmed guest has already been asked." };

  startOutboxWorker();
  await recordAuditEvent({
    action: ATTENDANCE_AUDIT.sent,
    actorUserId,
    organisationId: context.org.id,
    targetType: "Event",
    targetId: eventId,
    metadata: { recipientCount: result.queued, firstSend: result.firstSend },
  });
  revalidatePath(`/dashboard/${context.org.slug}/event/${eventId}`);
  return { ok: true, data: { queued: result.queued } };
}

/**
 * Remind guests who have not replied, at most once per 12 hours each. The
 * link is rotated, so only the newest email's link works (an older queued
 * email is dropped at delivery). Allowed until the event starts.
 */
export async function remindAttendanceChecksForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ queued: number }>> {
  if (!actorUserId) return { ok: false, error: "You must be signed in." };
  const parsed = attendanceCheckRefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (await isActionRateLimited("attendanceCheckSend", actorUserId)) {
    return { ok: false, error: "Too many attendance emails sent recently. Please wait before sending again." };
  }
  const context = await requireAttendanceContext(actorUserId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return context;
  const eventId = context.event.id;

  let result: { queued: number } | { error: string };
  try {
    result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
      const locked = await tx.event.findUnique({ where: { id: eventId }, select: { startDateTime: true, status: true } });
      if (locked?.status === EventStatus.CANCELLED) return { error: CANCELLED_ERROR };
      if (!locked || !attendanceCheckOpen(locked.startDateTime)) return { error: "This event has started, so guests can no longer be reminded." };
      const now = new Date();
      const due = await tx.attendanceCheck.findMany({
        where: remindableWhere(eventId, now),
        select: { id: true, rsvpId: true, rsvp: { select: { guestEmail: true, user: { select: { email: true } } } } },
      });
      const planned = due.flatMap((check) => {
        const to = recipientEmail(check.rsvp);
        return to ? [{ id: check.id, rsvpId: check.rsvpId, to, token: generateAttendanceToken() }] : [];
      });
      if (planned.length === 0) return { queued: 0 };
      const threshold = new Date(now.getTime() - ATTENDANCE_REMINDER_INTERVAL_MS);
      // One statement rotates every due link; the guard re-checks "no reply, still due".
      const rotated = await tx.$queryRaw<Array<{ rsvpId: string }>>`
        UPDATE "AttendanceCheck" AS a
        SET "tokenHash" = v."hash", "sentAt" = ${sqlUtcTimestamp(now)}, "updatedAt" = ${sqlUtcTimestamp(now)}
        FROM unnest(${planned.map((row) => row.id)}::text[], ${planned.map((row) => row.token.hash)}::text[]) AS v("id", "hash")
        WHERE a."id" = v."id" AND a."response" IS NULL AND a."sentAt" <= ${sqlUtcTimestamp(threshold)}
        RETURNING a."rsvpId"`;
      const rotatedIds = new Set(rotated.map((row) => row.rsvpId));
      const payloads: AttendanceCheckPayload[] = planned
        .filter((row) => rotatedIds.has(row.rsvpId))
        .map((row) => ({ to: row.to, rsvpId: row.rsvpId, token: row.token.raw, reminder: true }));
      await enqueueAttendanceChecks(tx, payloads);
      return { queued: payloads.length };
    }, { timeout: 60_000 });
  } catch {
    console.error("[attendance check] reminder queueing failed");
    return { ok: false, error: "Could not queue the reminders. Please try again." };
  }
  if ("error" in result) return { ok: false, error: result.error };
  if (result.queued === 0) return { ok: false, error: "No one is due a reminder. Each guest can be reminded once every 12 hours." };

  startOutboxWorker();
  await recordAuditEvent({
    action: ATTENDANCE_AUDIT.reminded,
    actorUserId,
    organisationId: context.org.id,
    targetType: "Event",
    targetId: eventId,
    metadata: { recipientCount: result.queued },
  });
  revalidatePath(`/dashboard/${context.org.slug}/event/${eventId}`);
  return { ok: true, data: { queued: result.queued } };
}

/** The release-on-decline switch. Same access as sending. */
export async function setAttendanceReleaseOnDeclineForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ releaseOnDecline: boolean }>> {
  if (!actorUserId) return { ok: false, error: "You must be signed in." };
  const parsed = attendanceCheckSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (await isActionRateLimited("attendanceCheckSettings", actorUserId)) return { ok: false, error: "Too many changes. Please wait a moment and try again." };
  const context = await requireAttendanceContext(actorUserId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return context;
  const releaseOnDecline = parsed.data.releaseOnDecline;
  if (context.event.attendanceCheckReleaseOnDecline !== releaseOnDecline) {
    await prisma.event.update({ where: { id: context.event.id }, data: { attendanceCheckReleaseOnDecline: releaseOnDecline } });
    await recordAuditEvent({
      action: ATTENDANCE_AUDIT.settings,
      actorUserId,
      organisationId: context.org.id,
      targetType: "Event",
      targetId: context.event.id,
      metadata: { releaseOnDecline },
    });
    revalidatePath(`/dashboard/${context.org.slug}/event/${context.event.id}`);
  }
  return { ok: true, data: { releaseOnDecline } };
}

/**
 * One guest's link, to share by hand (Guests · People). No email is queued.
 * Only the digest is stored, so a link can't be shown twice: this always
 * issues a new one. A guest not yet asked is asked now (a later send skips
 * them); for a guest already asked the new link replaces the old one, which
 * stops working, and a queued email with it is dropped at delivery. Same
 * access as sending, and allowed until the event starts.
 */
export async function issueAttendanceLinkForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ path: string; replaced: boolean }>> {
  if (!actorUserId) return { ok: false, error: "You must be signed in." };
  const parsed = attendanceLinkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  if (await isActionRateLimited("attendanceCheckLink", actorUserId)) return { ok: false, error: "Too many links created recently. Please wait a few minutes and try again." };
  const context = await requireAttendanceContext(actorUserId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!context.ok) return context;
  const eventId = context.event.id;
  const rsvpId = parsed.data.rsvpId;

  let result: { token: string; replaced: boolean } | { error: string };
  try {
    result = await prisma.$transaction(async (tx) => {
      // The send's lock: a concurrent send can't also ask this guest.
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE`;
      const locked = await tx.event.findUnique({ where: { id: eventId }, select: { startDateTime: true, status: true } });
      if (locked?.status === EventStatus.CANCELLED) return { error: CANCELLED_ERROR };
      if (!locked || !attendanceCheckOpen(locked.startDateTime)) return { error: "This event has started, so guests can no longer be asked." };
      const rsvp = await tx.rSVP.findFirst({ where: { id: rsvpId, eventId }, select: { status: true, eventId: true, isCrew: true, attendanceCheck: { select: { id: true } } } });
      if (!rsvp) return { error: "Guest not found." };
      if (!isAttendanceCheckRecipient(rsvp)) return { error: "Only confirmed guests can be asked to confirm attendance." };
      const token = generateAttendanceToken();
      const sentAt = new Date();
      if (rsvp.attendanceCheck) {
        await tx.attendanceCheck.update({ where: { id: rsvp.attendanceCheck.id }, data: { tokenHash: token.hash, sentAt } });
      } else {
        await tx.attendanceCheck.create({ data: { rsvpId, eventId, tokenHash: token.hash, sentAt } });
      }
      return { token: token.raw, replaced: rsvp.attendanceCheck != null };
    });
  } catch {
    console.error("[attendance check] link creation failed");
    return { ok: false, error: "Could not create the link. Please try again." };
  }
  if ("error" in result) return { ok: false, error: result.error };

  await recordAuditEvent({
    action: ATTENDANCE_AUDIT.linkShared,
    actorUserId,
    organisationId: context.org.id,
    targetType: "Event",
    targetId: eventId,
    metadata: { rsvpId, replaced: result.replaced },
  });
  revalidatePath(`/dashboard/${context.org.slug}/event/${eventId}`);
  return { ok: true, data: { path: attendancePath(result.token), replaced: result.replaced } };
}

/* ---------- The guest's side: /attend/{token} ---------- */

export type AttendanceFormView = {
  eventTitle: string;
  organisationName: string;
  startDateTime: string;
  endDateTime: string;
  timezone: string;
  location: string;
  isOnline: boolean;
  accentColor: string | null;
  attendeeName: string;
  attendeeEmail: string;
  teamName: string | null;
  response: AttendanceResponseValue | null;
  respondedAt: string | null;
  note: string;
  releaseOnDecline: boolean;
  closed: AttendanceReplyClosed | null;
};

/**
 * The form's view for a raw link token, or null for a malformed, rotated or
 * unknown token (the page answers a real 404). Only this registration's own
 * name, email and answer; never other attendees, the ticket token, or
 * check-in state.
 */
export async function resolveAttendanceCheckByToken(rawToken: string, now: Date = new Date()): Promise<AttendanceFormView | null> {
  if (!isAttendanceTokenShape(rawToken)) return null;
  const check = await prisma.attendanceCheck.findUnique({
    where: { tokenHash: hashAttendanceToken(rawToken) },
    select: {
      response: true,
      respondedAt: true,
      note: true,
      rsvp: { select: { status: true, eventId: true, guestName: true, guestEmail: true, user: { select: { name: true, email: true } }, team: { select: { name: true } } } },
      event: {
        select: {
          title: true,
          status: true,
          startDateTime: true,
          endDateTime: true,
          timezone: true,
          location: true,
          isOnline: true,
          attendanceCheckReleaseOnDecline: true,
          organisation: { select: { name: true } },
          page: { select: { accentColor: true } },
        },
      },
    },
  });
  if (!check || check.rsvp.eventId == null) return null;
  const email = check.rsvp.user?.email ?? check.rsvp.guestEmail ?? "";
  return {
    eventTitle: check.event.title,
    organisationName: check.event.organisation.name,
    startDateTime: check.event.startDateTime.toISOString(),
    endDateTime: check.event.endDateTime.toISOString(),
    timezone: check.event.timezone,
    location: check.event.location,
    isOnline: check.event.isOnline,
    accentColor: check.event.page?.accentColor ?? null,
    attendeeName: check.rsvp.user?.name?.trim() || check.rsvp.guestName?.trim() || email.split("@")[0] || "Guest",
    attendeeEmail: email,
    teamName: check.rsvp.team?.name ?? null,
    response: check.response,
    respondedAt: check.respondedAt?.toISOString() ?? null,
    note: check.note ?? "",
    releaseOnDecline: check.event.attendanceCheckReleaseOnDecline,
    closed: attendanceReplyClosedReason({ rsvpStatus: check.rsvp.status, eventStart: check.event.startDateTime, eventStatus: check.event.status, now }),
  };
}

export type AttendanceReplyResult = { response: AttendanceResponseValue; released: boolean; releaseFailed?: string };

/**
 * Record the guest's answer. The token is the only credential (a bearer
 * capability, rate limited per link and per address). "No" with release on
 * cancels the registration through the self-cancel core, so capacity, the
 * waitlist and team rules (leader handover, team units) apply exactly as when
 * the guest cancels from their ticket. A released place cannot be taken back
 * from this page.
 */
export async function respondToAttendanceCheck(input: unknown): Promise<ActionResult<AttendanceReplyResult>> {
  const parsed = attendanceReplySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.path[0] === "note" ? issue.message : "Choose Yes or No." };
  }
  const { token, response, note } = parsed.data;
  if (await isActionRateLimited("attendanceCheckReply", token)) return { ok: false, error: "Too many attempts. Please wait a minute and try again." };

  const check = await prisma.attendanceCheck.findUnique({
    where: { tokenHash: hashAttendanceToken(token) },
    select: {
      id: true,
      eventId: true,
      rsvp: { select: { id: true, status: true, eventId: true, userId: true, checkInToken: true } },
      event: { select: { startDateTime: true, status: true, organisationId: true, attendanceCheckReleaseOnDecline: true } },
    },
  });
  if (!check || check.rsvp.eventId == null) return { ok: false, error: "This link is no longer valid." };
  const closed = attendanceReplyClosedReason({ rsvpStatus: check.rsvp.status, eventStart: check.event.startDateTime, eventStatus: check.event.status });
  if (closed === "cancelled") return { ok: false, error: "This event has been cancelled, so answers are closed." };
  if (closed === "started") return { ok: false, error: "The event has started, so answers are closed." };
  if (closed === "notConfirmed") return { ok: false, error: "Your registration is no longer confirmed, so there is nothing to answer." };

  const now = new Date();
  const updated = await prisma.attendanceCheck.updateMany({
    // The token must still be current (a reminder may have rotated it meanwhile).
    where: { id: check.id, tokenHash: hashAttendanceToken(token) },
    data: { response, respondedAt: now, note: note || null },
  });
  if (updated.count !== 1) return { ok: false, error: "This link is no longer valid." };

  if (response !== "NOT_ATTENDING" || !check.event.attendanceCheckReleaseOnDecline) {
    return { ok: true, data: { response, released: false } };
  }

  // Release: the guest's own cancellation, authorised by this link.
  // No revalidation: it would re-render this page, now a 404, over the
  // "Your place has been released" result (see cancelRsvpForUser).
  const cancelled = await cancelRsvpForUser(check.rsvp.userId, { checkInToken: check.rsvp.checkInToken }, { revalidate: false });
  if (!cancelled.ok) {
    // The answer is recorded; the place stays (for example, already checked in).
    return { ok: true, data: { response, released: false, releaseFailed: cancelled.error } };
  }
  await recordAuditEvent({
    action: ATTENDANCE_AUDIT.released,
    actorUserId: check.rsvp.userId,
    organisationId: check.event.organisationId,
    targetType: "Event",
    targetId: check.eventId,
    metadata: { rsvpId: check.rsvp.id },
  });
  return { ok: true, data: { response, released: true } };
}
