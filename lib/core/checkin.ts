import "server-only";

import { revalidatePath } from "next/cache";
import { gateCheckInForStatus, parseCheckInPayload } from "@/lib/checkIn";
import { prisma } from "@/lib/db";
import { EventPermission, Prisma, type AttendanceResponse, type RsvpStatus } from "@prisma/client";
import { attendanceStateOf, type AttendanceState } from "@/lib/attendanceCheck";
import { canAccessEvent } from "@/lib/eventAccess";
import {
  attendeeLookupSchema,
  checkInByRsvpIdSchema,
  checkInByTokenSchema,
  offlineCheckInRosterSchema,
  syncOfflineCheckInsSchema,
  undoCheckInSchema,
} from "@/lib/validators";
import type { ActionResult } from "@/app/actions/org";
import { flattenZodErrors } from "@/app/actions/utils";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { commitCheckInProjection, commitUndoCheckInProjection } from "@/lib/checkInMutations";
import { z } from "zod";
import { listRecentCheckIns, recentCheckInsCursorSchema, type RecentCheckInsPage } from "@/lib/checkInRecent";
import {
  getCheckInDetails,
  getRegistrationDetails,
  type CheckInDetail,
  type RegistrationDetail,
} from "@/lib/checkInDetails";

export type CheckInResultData = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  status: string;
  alreadyCheckedIn: boolean;
  checkedInAt: string | null;
  /** Bearer QR token for the active, authorised print flow. Never persist or audit it. */
  checkInQrToken: string;
  checkInDetails: CheckInDetail[];
  registrationDetails: RegistrationDetail[];
  /** TEAM events: the attendee's team name, shown at the desk, on badges and in the mobile `CheckInResult.teamName`. */
  teamName?: string | null;
  /** Attendance confirmation reply, shown as a badge at the desk; null when the guest was never asked. Web desk only. */
  attendance?: AttendanceState | null;
};

/** The desk's attendance badge: only for guests who were asked (the note stays in Guests · People). */
function deskAttendanceState(check: { response: AttendanceResponse | null } | null | undefined): AttendanceState | null {
  return check ? attendanceStateOf(check) : null;
}

/** Where a check-in came from; recorded in the immutable check-in history. */
export type CheckInCoreOptions = { source?: "online" | "mobile-scan" | "mobile-manual" };

export type CheckInPreviewData = CheckInResultData & {
  gate: { ok: true } | { ok: false; reason: string; needsForce: boolean; blocked?: boolean };
};

function revalidateAfterCheckIn(
  orgSlug: string,
  rsvp: {
    eventId: string | null;
    event: { slug: string } | null;
    eventInstanceId: string | null;
  },
) {
  if (rsvp.eventId && rsvp.event) {
    revalidatePath(`/dashboard/${orgSlug}/event/${rsvp.eventId}`);
    revalidatePath(`/dashboard/${orgSlug}/event/${rsvp.eventId}/check-in`);
    revalidatePath(`/${orgSlug}/${rsvp.event.slug}`);
  }
  if (rsvp.eventInstanceId) {
    revalidatePath(`/${orgSlug}/i/${rsvp.eventInstanceId}`);
  }
  revalidatePath(`/${orgSlug}`);
}

async function requireOrgMemberForEvent(
  actorUserId: string | null,
  organisationSlug: string,
  eventId: string,
) {
  if (!actorUserId) {
    return { ok: false as const, error: "You must be signed in." };
  }
  const session = { user: { id: actorUserId } };
  if (await isActionRateLimited("checkin", session.user.id)) {
    return { ok: false as const, error: "Too many check-in requests. Please try again shortly." };
  }
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false as const, error: "Organisation not found." };

  if (!(await canAccessEvent({ userId: session.user.id, organisationId: org.id, eventId, permission: EventPermission.CHECK_IN }))) {
    return { ok: false as const, error: "You do not have permission to operate check-in." };
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: org.id },
  });
  if (!event) return { ok: false as const, error: "Event not found." };

  return {
    ok: true as const,
    event,
    orgSlug: org.slug,
    actorUserId: session.user.id,
  };
}

function attendeeLabel(r: {
  user: { name: string | null; email: string | null } | null;
  guestName?: string | null;
  guestEmail: string | null;
}) {
  const name = r.user?.name?.trim();
  if (name) return name;
  const gn = r.guestName?.trim();
  if (gn) return gn;
  const email = r.user?.email ?? r.guestEmail;
  return email ?? "Guest";
}

async function resolveRsvpForToken(
  actorUserId: string | null,
  organisationSlug: string,
  eventId: string,
  rawInput: string,
) {
  const ctx = await requireOrgMemberForEvent(actorUserId, organisationSlug, eventId);
  if (!ctx.ok) return { ok: false as const, error: ctx.error };

  const token = parseCheckInPayload(rawInput);
  if (!token) {
    return { ok: false as const, error: "Could not read a ticket code from that input." };
  }

  const rsvp = await prisma.rSVP.findFirst({
    where: { checkInToken: token },
    include: {
      user: { select: { name: true, email: true } },
      team: { select: { name: true } },
      attendanceCheck: { select: { response: true } },
      answers: { include: { field: { select: { key: true, label: true } } } },
      event: { select: { id: true, organisationId: true, slug: true } },
      eventInstance: {
        include: { series: { select: { organisationId: true } } },
      },
    },
  });

  if (!rsvp) {
    return { ok: false as const, error: "No matching ticket found." };
  }

  const orgId = ctx.event.organisationId;
  if (rsvp.eventId && rsvp.event) {
    if (rsvp.event.organisationId !== orgId || rsvp.eventId !== ctx.event.id) {
      return { ok: false as const, error: "This ticket is not for this event." };
    }
  } else if (rsvp.eventInstanceId && rsvp.eventInstance) {
    // This station is for one standalone event. A series occurrence must be
    // checked in from its own dedicated workflow, never merely by org match.
    return { ok: false as const, error: "This ticket is not for this event." };
  } else {
    return { ok: false as const, error: "Invalid registration." };
  }

  return { ok: true as const, ctx, rsvp };
}

export async function previewCheckInByTokenForUser(
  actorUserId: string | null,
  input: unknown,
): Promise<ActionResult<CheckInPreviewData>> {
  const parsed = checkInByTokenSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, rawInput, force } = parsed.data;
  const resolved = await resolveRsvpForToken(actorUserId, organisationSlug, eventId, rawInput);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const { rsvp } = resolved;
  const gate = gateCheckInForStatus(rsvp.status, Boolean(force));

  return {
    ok: true,
    data: {
      rsvpId: rsvp.id,
      displayName: attendeeLabel(rsvp),
      email: rsvp.user?.email ?? rsvp.guestEmail,
      status: rsvp.status,
      alreadyCheckedIn: Boolean(rsvp.checkedInAt),
      checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
      checkInQrToken: rsvp.checkInToken,
      checkInDetails: getCheckInDetails(rsvp.answers),
      registrationDetails: getRegistrationDetails(rsvp.answers),
      teamName: rsvp.team?.name ?? null,
      attendance: deskAttendanceState(rsvp.attendanceCheck),
      gate,
    },
  };
}

export async function checkInByTokenForUser(
  actorUserId: string | null,
  input: unknown,
  options: CheckInCoreOptions = {},
): Promise<ActionResult<CheckInResultData>> {
  const parsed = checkInByTokenSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, rawInput, force } = parsed.data;
  const resolved = await resolveRsvpForToken(actorUserId, organisationSlug, eventId, rawInput);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { ctx, rsvp } = resolved;

  const gate = gateCheckInForStatus(rsvp.status, Boolean(force));
  if (!gate.ok) {
    if (gate.blocked) {
      return {
        ok: false,
        error: gate.reason,
      };
    }
    return {
      ok: false,
      error: gate.reason,
      needsForce: true,
    };
  }

  if (rsvp.checkedInAt) {
    return {
      ok: true,
      data: {
        rsvpId: rsvp.id,
        displayName: attendeeLabel(rsvp),
        email: rsvp.user?.email ?? rsvp.guestEmail,
        status: rsvp.status,
        alreadyCheckedIn: true,
        checkedInAt: rsvp.checkedInAt.toISOString(),
        checkInQrToken: rsvp.checkInToken,
        checkInDetails: getCheckInDetails(rsvp.answers),
        registrationDetails: getRegistrationDetails(rsvp.answers),
        teamName: rsvp.team?.name ?? null,
        attendance: deskAttendanceState(rsvp.attendanceCheck),
      },
    };
  }

  const now = new Date();
  const committed = await commitCheckInProjection({
    rsvpId: rsvp.id,
    actorUserId: ctx.actorUserId,
    source: options.source ?? "online",
    checkedInAt: now,
    force: Boolean(force),
  });
  if (committed.state !== "checked-in") {
    if (committed.state === "missing") return { ok: false, error: "RSVP not found." };
    if (committed.state === "ineligible") {
      const currentGate = gateCheckInForStatus(committed.status, Boolean(force));
      return { ok: false, error: currentGate.ok ? "Check-in could not be completed." : currentGate.reason };
    }
    return {
      ok: true,
      data: {
        rsvpId: rsvp.id,
        displayName: attendeeLabel(rsvp),
        email: rsvp.user?.email ?? rsvp.guestEmail,
        status: rsvp.status,
        alreadyCheckedIn: true,
        checkedInAt: committed.checkedInAt.toISOString(),
        checkInQrToken: rsvp.checkInToken,
        checkInDetails: getCheckInDetails(rsvp.answers),
        registrationDetails: getRegistrationDetails(rsvp.answers),
        teamName: rsvp.team?.name ?? null,
        attendance: deskAttendanceState(rsvp.attendanceCheck),
      },
    };
  }

  revalidateAfterCheckIn(ctx.orgSlug, {
    eventId: rsvp.eventId,
    event: rsvp.event,
    eventInstanceId: rsvp.eventInstanceId,
  });

  return {
    ok: true,
    data: {
      rsvpId: rsvp.id,
      displayName: attendeeLabel(rsvp),
      email: rsvp.user?.email ?? rsvp.guestEmail,
      status: rsvp.status,
      alreadyCheckedIn: false,
      checkedInAt: now.toISOString(),
      checkInQrToken: rsvp.checkInToken,
      checkInDetails: getCheckInDetails(rsvp.answers),
      registrationDetails: getRegistrationDetails(rsvp.answers),
      teamName: rsvp.team?.name ?? null,
      attendance: deskAttendanceState(rsvp.attendanceCheck),
    },
  };
}

export async function undoCheckInForUser(actorUserId: string | null, input: unknown, options: CheckInCoreOptions = {}): Promise<ActionResult> {
  const parsed = undoCheckInSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, rsvpId } = parsed.data;
  const ctx = await requireOrgMemberForEvent(actorUserId, organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const rsvp = await prisma.rSVP.findFirst({
    where: { id: rsvpId },
    include: {
      event: { select: { slug: true, organisationId: true } },
      eventInstance: {
        include: { series: { select: { organisationId: true } } },
      },
    },
  });
  if (!rsvp) return { ok: false, error: "RSVP not found." };

  const orgId = ctx.event.organisationId;
  if (rsvp.eventId) {
    if (rsvp.eventId !== ctx.event.id || rsvp.event?.organisationId !== orgId) {
      return { ok: false, error: "RSVP not found." };
    }
  } else if (rsvp.eventInstanceId) {
    return { ok: false, error: "RSVP not found." };
  } else {
    return { ok: false, error: "RSVP not found." };
  }

  const undone = await commitUndoCheckInProjection({ rsvpId: rsvp.id, actorUserId: ctx.actorUserId, source: options.source ?? "online" });
  if (!undone) return { ok: false, error: "This attendee is not currently checked in." };

  revalidateAfterCheckIn(ctx.orgSlug, {
    eventId: rsvp.eventId,
    event: rsvp.event ? { slug: rsvp.event.slug } : null,
    eventInstanceId: rsvp.eventInstanceId,
  });
  return { ok: true };
}

export type LookupRow = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  status: string;
  checkedInAt: string | null;
  /** Registration time and account/guest flag, used by the mobile API's guest DTO. */
  registeredAt?: string;
  isGuest?: boolean;
  /** TEAM events: the attendee's team name (web desk and the mobile `Guest.teamName`). */
  teamName?: string | null;
  /** Attendance confirmation reply badge (web desk only); null when never asked. */
  attendance?: AttendanceState | null;
};

export type OfflineCheckInRosterRow = LookupRow & {
  ticketToken: string;
  checkInDetails: CheckInDetail[];
  registrationDetails: RegistrationDetail[];
};

export async function downloadOfflineCheckInRosterForUser(
  actorUserId: string | null,
  input: unknown,
): Promise<ActionResult<{ generatedAt: string; rows: OfflineCheckInRosterRow[] }>> {
  const parsed = offlineCheckInRosterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid offline roster request." };
  }

  const { organisationSlug, eventId } = parsed.data;
  const ctx = await requireOrgMemberForEvent(actorUserId, organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  // The whole roster in two set-based reads (registrations with their user
  // and team joined in SQL, then every answer of those registrations), not a
  // relation lookup per registration id.
  const rosterStatuses: RsvpStatus[] = ["CONFIRMED", "WAITLISTED", "PENDING_APPROVAL"];
  const [rsvps, answers] = await Promise.all([
    prisma.$queryRaw<
      Array<{ id: string; checkInToken: string; guestName: string | null; guestEmail: string | null; status: RsvpStatus; checkedInAt: Date | null; createdAt: Date; userId: string | null; userName: string | null; userEmail: string | null; teamName: string | null; attendanceResponse: AttendanceResponse | null; attendanceAsked: boolean }>
    >`
      SELECT r."id", r."checkInToken", r."guestName", r."guestEmail", r."status", r."checkedInAt", r."createdAt", r."userId",
        u."name" AS "userName", u."email" AS "userEmail", t."name" AS "teamName",
        ac."response" AS "attendanceResponse", (ac."id" IS NOT NULL) AS "attendanceAsked"
      FROM "RSVP" r
      LEFT JOIN "User" u ON u."id" = r."userId"
      LEFT JOIN "Team" t ON t."id" = r."teamId"
      LEFT JOIN "AttendanceCheck" ac ON ac."rsvpId" = r."id"
      WHERE r."eventId" = ${ctx.event.id} AND r."status"::text IN (${Prisma.join(rosterStatuses)})
      ORDER BY r."createdAt" DESC`,
    prisma.rsvpAnswer.findMany({
      where: { rsvp: { eventId: ctx.event.id, status: { in: rosterStatuses } } },
      select: { rsvpId: true, valueText: true, valueBool: true, valueNumber: true, valueDate: true, field: { select: { key: true, label: true } } },
      orderBy: { id: "asc" },
    }),
  ]);
  const answersByRsvp = new Map<string, typeof answers>();
  for (const answer of answers) {
    const list = answersByRsvp.get(answer.rsvpId);
    if (list) list.push(answer);
    else answersByRsvp.set(answer.rsvpId, [answer]);
  }

  return {
    ok: true,
    data: {
      generatedAt: new Date().toISOString(),
      rows: rsvps.map((r) => {
        const user = r.userId ? { name: r.userName, email: r.userEmail } : null;
        const rsvpAnswers = answersByRsvp.get(r.id) ?? [];
        return {
          rsvpId: r.id,
          ticketToken: r.checkInToken,
          displayName: attendeeLabel({ user, guestName: r.guestName, guestEmail: r.guestEmail }),
          email: user?.email ?? r.guestEmail,
          status: r.status,
          checkedInAt: r.checkedInAt?.toISOString() ?? null,
          registeredAt: r.createdAt.toISOString(),
          isGuest: r.userId == null,
          checkInDetails: getCheckInDetails(rsvpAnswers),
          registrationDetails: getRegistrationDetails(rsvpAnswers),
          teamName: r.teamName,
          attendance: deskAttendanceState(r.attendanceAsked ? { response: r.attendanceResponse } : null),
        };
      }),
    },
  };
}

export async function syncOfflineCheckInsForUser(
  actorUserId: string | null,
  input: unknown,
): Promise<ActionResult<{ syncedIds: string[]; alreadyCheckedInIds: string[]; failed: { rsvpId: string; error: string }[] }>> {
  const parsed = syncOfflineCheckInsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid offline check-in queue." };
  }

  const { organisationSlug, eventId, checkIns } = parsed.data;
  const ctx = await requireOrgMemberForEvent(actorUserId, organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const rsvps = await prisma.rSVP.findMany({
    where: { eventId: ctx.event.id, id: { in: checkIns.map((checkIn) => checkIn.rsvpId) } },
    select: { id: true, status: true, checkedInAt: true },
  });
  const rsvpById = new Map(rsvps.map((rsvp) => [rsvp.id, rsvp]));
  const syncedIds: string[] = [];
  const alreadyCheckedInIds: string[] = [];
  const failed: { rsvpId: string; error: string }[] = [];
  const seenRsvpIds = new Set<string>();

  for (const checkIn of checkIns) {
    if (seenRsvpIds.has(checkIn.rsvpId)) {
      failed.push({ rsvpId: checkIn.rsvpId, error: "Duplicate offline check-in entry." });
      continue;
    }
    seenRsvpIds.add(checkIn.rsvpId);
    const rsvp = rsvpById.get(checkIn.rsvpId);
    if (!rsvp) {
      failed.push({ rsvpId: checkIn.rsvpId, error: "RSVP not found for this event." });
      continue;
    }
    const gate = gateCheckInForStatus(rsvp.status, checkIn.force);
    if (!gate.ok) {
      failed.push({ rsvpId: checkIn.rsvpId, error: gate.reason });
      continue;
    }
    const checkedInAt = new Date(checkIn.checkedInAt);
    const earliest = ctx.event.startDateTime.getTime() - 24 * 60 * 60_000;
    const latest = Math.min(Date.now() + 5 * 60_000, ctx.event.endDateTime.getTime() + 60 * 60_000);
    if (checkedInAt.getTime() < earliest || checkedInAt.getTime() > latest) {
      failed.push({ rsvpId: checkIn.rsvpId, error: "Offline check-in time is outside the event operating window." });
      continue;
    }
    if (rsvp.checkedInAt) {
      alreadyCheckedInIds.push(rsvp.id);
      continue;
    }
    const committed = await commitCheckInProjection({
      rsvpId: rsvp.id,
      actorUserId: ctx.actorUserId,
      source: "offline-sync",
      checkedInAt,
      force: checkIn.force,
    });
    if (committed.state === "checked-in") {
      syncedIds.push(rsvp.id);
    } else if (committed.state === "already-checked-in") {
      alreadyCheckedInIds.push(rsvp.id);
    } else {
        const currentGate = committed.state === "ineligible" ? gateCheckInForStatus(committed.status, checkIn.force) : null;
        failed.push({
          rsvpId: rsvp.id,
          error: committed.state === "missing" ? "RSVP not found for this event." : currentGate?.ok ? "Check-in could not be completed." : currentGate!.reason,
        });
    }
  }

  if (syncedIds.length > 0) {
    revalidatePath(`/dashboard/${ctx.orgSlug}/event/${ctx.event.id}`);
    revalidatePath(`/dashboard/${ctx.orgSlug}/event/${ctx.event.id}/check-in`);
  }

  return { ok: true, data: { syncedIds, alreadyCheckedInIds, failed } };
}

export async function lookupAttendeesForCheckInForUser(
  actorUserId: string | null,
  input: unknown,
): Promise<ActionResult<{ rows: LookupRow[] }>> {
  const parsed = attendeeLookupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, query } = parsed.data;
  const ctx = await requireOrgMemberForEvent(actorUserId, organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const q = query.trim().toLowerCase();
  if (q.length < 2) {
    return { ok: true, data: { rows: [] } };
  }

  const rsvps = await prisma.rSVP.findMany({
    where: {
      eventId: ctx.event.id,
      OR: [
        { guestEmail: { contains: q, mode: "insensitive" } },
        { guestName: { contains: q, mode: "insensitive" } },
        { user: { email: { contains: q, mode: "insensitive" } } },
        { user: { name: { contains: q, mode: "insensitive" } } },
        // TEAM events: typing a team name lists its members. The team is
        // matched inside this event only.
        { team: { eventId: ctx.event.id, name: { contains: q, mode: "insensitive" } } },
      ],
    },
    take: 12,
    include: { user: { select: { name: true, email: true } }, team: { select: { name: true } }, attendanceCheck: { select: { response: true } } },
    orderBy: { createdAt: "desc" },
  });

  const rows: LookupRow[] = rsvps.map((r) => ({
    rsvpId: r.id,
    displayName: attendeeLabel(r),
    email: r.user?.email ?? r.guestEmail,
    status: r.status,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    registeredAt: r.createdAt.toISOString(),
    isGuest: r.userId == null,
    teamName: r.team?.name ?? null,
    attendance: deskAttendanceState(r.attendanceCheck),
  }));

  return { ok: true, data: { rows } };
}

/**
 * Loads the same door details used by QR preview before a staff member confirms
 * a check-in selected from attendee search.
 */
export async function previewCheckInByRsvpIdForUser(
  actorUserId: string | null,
  input: unknown,
): Promise<ActionResult<CheckInPreviewData>> {
  const parsed = checkInByRsvpIdSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, rsvpId, force } = parsed.data;
  const ctx = await requireOrgMemberForEvent(actorUserId, organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const rsvp = await prisma.rSVP.findFirst({
    where: { id: rsvpId, eventId: ctx.event.id },
    include: {
      user: { select: { name: true, email: true } },
      team: { select: { name: true } },
      attendanceCheck: { select: { response: true } },
      answers: { include: { field: { select: { key: true, label: true } } } },
    },
  });
  if (!rsvp) return { ok: false, error: "RSVP not found." };

  return {
    ok: true,
    data: {
      rsvpId: rsvp.id,
      displayName: attendeeLabel(rsvp),
      email: rsvp.user?.email ?? rsvp.guestEmail,
      status: rsvp.status,
      alreadyCheckedIn: Boolean(rsvp.checkedInAt),
      checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
      checkInQrToken: rsvp.checkInToken,
      checkInDetails: getCheckInDetails(rsvp.answers),
      registrationDetails: getRegistrationDetails(rsvp.answers),
      teamName: rsvp.team?.name ?? null,
      attendance: deskAttendanceState(rsvp.attendanceCheck),
      gate: gateCheckInForStatus(rsvp.status, Boolean(force)),
    },
  };
}

export async function checkInByRsvpIdForUser(
  actorUserId: string | null,
  input: unknown,
  options: CheckInCoreOptions = {},
): Promise<ActionResult<CheckInResultData>> {
  const parsed = checkInByRsvpIdSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, rsvpId, force } = parsed.data;
  const ctx = await requireOrgMemberForEvent(actorUserId, organisationSlug, eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };

  const rsvp = await prisma.rSVP.findFirst({
    where: { id: rsvpId, eventId: ctx.event.id },
    include: {
      user: { select: { name: true, email: true } },
      team: { select: { name: true } },
      attendanceCheck: { select: { response: true } },
      answers: { include: { field: { select: { key: true, label: true } } } },
      event: { select: { slug: true } },
      eventInstance: { select: { id: true } },
    },
  });
  if (!rsvp) return { ok: false, error: "RSVP not found." };

  const gate = gateCheckInForStatus(rsvp.status, Boolean(force));
  if (!gate.ok) {
    if (gate.blocked) {
      return { ok: false, error: gate.reason };
    }
    return {
      ok: false,
      error: gate.reason,
      needsForce: true,
    };
  }

  if (rsvp.checkedInAt) {
    return {
      ok: true,
      data: {
        rsvpId: rsvp.id,
        displayName: attendeeLabel(rsvp),
        email: rsvp.user?.email ?? rsvp.guestEmail,
        status: rsvp.status,
        alreadyCheckedIn: true,
        checkedInAt: rsvp.checkedInAt.toISOString(),
        checkInQrToken: rsvp.checkInToken,
        checkInDetails: getCheckInDetails(rsvp.answers),
        registrationDetails: getRegistrationDetails(rsvp.answers),
        teamName: rsvp.team?.name ?? null,
        attendance: deskAttendanceState(rsvp.attendanceCheck),
      },
    };
  }

  const now = new Date();
  const committed = await commitCheckInProjection({
    rsvpId: rsvp.id,
    actorUserId: ctx.actorUserId,
    source: options.source ?? "online",
    checkedInAt: now,
    force: Boolean(force),
  });
  if (committed.state !== "checked-in") {
    if (committed.state === "missing") return { ok: false, error: "RSVP not found." };
    if (committed.state === "ineligible") {
      const currentGate = gateCheckInForStatus(committed.status, Boolean(force));
      return { ok: false, error: currentGate.ok ? "Check-in could not be completed." : currentGate.reason };
    }
    return {
      ok: true,
      data: {
        rsvpId: rsvp.id,
        displayName: attendeeLabel(rsvp),
        email: rsvp.user?.email ?? rsvp.guestEmail,
        status: rsvp.status,
        alreadyCheckedIn: true,
        checkedInAt: committed.checkedInAt.toISOString(),
        checkInQrToken: rsvp.checkInToken,
        checkInDetails: getCheckInDetails(rsvp.answers),
        registrationDetails: getRegistrationDetails(rsvp.answers),
        teamName: rsvp.team?.name ?? null,
        attendance: deskAttendanceState(rsvp.attendanceCheck),
      },
    };
  }

  revalidateAfterCheckIn(ctx.orgSlug, {
    eventId: rsvp.eventId,
    event: rsvp.event,
    eventInstanceId: rsvp.eventInstanceId,
  });

  return {
    ok: true,
    data: {
      rsvpId: rsvp.id,
      displayName: attendeeLabel(rsvp),
      email: rsvp.user?.email ?? rsvp.guestEmail,
      status: rsvp.status,
      alreadyCheckedIn: false,
      checkedInAt: now.toISOString(),
      checkInQrToken: rsvp.checkInToken,
      checkInDetails: getCheckInDetails(rsvp.answers),
      registrationDetails: getRegistrationDetails(rsvp.answers),
      teamName: rsvp.team?.name ?? null,
      attendance: deskAttendanceState(rsvp.attendanceCheck),
    },
  };
}

const recentCheckInsSchema = z
  .object({
    organisationSlug: z.string().trim().min(1).max(200),
    eventId: z.string().trim().min(1).max(128),
    cursor: recentCheckInsCursorSchema,
  })
  .strict();

/** "Load more" on the desk's Recent check-ins: the same CHECK_IN access and rate limit as the desk. */
export async function loadRecentCheckInsForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<RecentCheckInsPage>> {
  const parsed = recentCheckInsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const ctx = await requireOrgMemberForEvent(actorUserId, parsed.data.organisationSlug, parsed.data.eventId);
  if (!ctx.ok) return { ok: false, error: ctx.error };
  return { ok: true, data: await listRecentCheckIns(ctx.event.id, parsed.data.cursor ?? null) };
}
