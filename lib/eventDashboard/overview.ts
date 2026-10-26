import "server-only";

import { cache } from "react";
import { AttendanceResponse, MembershipRole, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/*
 * Loaders for the event dashboard's Overview and Analytics tabs. The event
 * has already been resolved inside its organisation (loadEventDashboard);
 * callers must check EventDashboardContext.permissions before calling the
 * guest-level loaders. Every select is explicit and returns names only.
 */

const DAY_MS = 86_400_000;

/** RSVP creation times over the last 14 days (organisation admins only). */
export const loadRecentSignupDates = cache(async (eventId: string, now: Date): Promise<Date[]> => {
  const rows = await prisma.rSVP.findMany({
    where: { eventId, createdAt: { gte: new Date(now.getTime() - 14 * DAY_MS), lte: now } },
    select: { createdAt: true },
  });
  return rows.map((row) => row.createdAt);
});

/** Every RSVP creation time for the event (organisation admins only). */
export const loadAllSignupDates = cache(async (eventId: string): Promise<Date[]> => {
  const rows = await prisma.rSVP.findMany({ where: { eventId }, select: { createdAt: true } });
  return rows.map((row) => row.createdAt);
});

export type PendingRequest = { id: string; name: string; createdAt: string };

/** The longest-waiting approval requests (organisation admins only). Names only, falling back to the guest's email. */
export const loadPendingRequests = cache(async (eventId: string, take = 5): Promise<PendingRequest[]> => {
  const rows = await prisma.rSVP.findMany({
    where: { eventId, status: RsvpStatus.PENDING_APPROVAL },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true, guestName: true, guestEmail: true, createdAt: true, user: { select: { name: true, email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.user?.name?.trim() || row.guestName?.trim() || row.user?.email || row.guestEmail || "Guest",
    createdAt: row.createdAt.toISOString(),
  }));
});

/** How many emails organisers have sent to this event's guests. */
export const loadBroadcastCount = cache(async (eventId: string) => prisma.eventBroadcast.count({ where: { eventId } }));

/**
 * Attendance confirmation replies for the Overview line (viewers who may
 * email guests only). Counts only, and the same rules as the Emails card:
 * "No reply" covers still-CONFIRMED guests. Null until someone was asked.
 */
export const loadAttendanceReplyCounts = cache(async (eventId: string): Promise<{ coming: number; notComing: number; noReply: number } | null> => {
  const [coming, notComing, noReply] = await Promise.all([
    prisma.attendanceCheck.count({ where: { eventId, response: AttendanceResponse.ATTENDING } }),
    prisma.attendanceCheck.count({ where: { eventId, response: AttendanceResponse.NOT_ATTENDING } }),
    prisma.attendanceCheck.count({ where: { eventId, response: null, rsvp: { status: RsvpStatus.CONFIRMED } } }),
  ]);
  return coming + notComing + noReply > 0 ? { coming, notComing, noReply } : null;
});

/** Feedback responses submitted for the event (a count only; responses may be anonymous). */
export const loadFeedbackCount = cache(async (eventId: string) => prisma.eventFeedbackResponse.count({ where: { form: { eventId } } }));

export type EventTeam = { admins: string[]; coOrganisers: string[] };

/** Names of the organisation's owners/admins and the event's co-organisers. Never emails. */
export const loadEventTeam = cache(async (organisationId: string, eventId: string): Promise<EventTeam> => {
  const [admins, collaborators] = await Promise.all([
    prisma.membership.findMany({
      where: { organisationId, role: { in: [MembershipRole.OWNER, MembershipRole.ADMIN] } },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { name: true } } },
    }),
    prisma.eventCollaborator.findMany({ where: { eventId }, orderBy: { createdAt: "asc" }, select: { user: { select: { name: true } } } }),
  ]);
  const name = (value: string | null) => value?.trim() || "Unnamed member";
  return { admins: admins.map((row) => name(row.user.name)), coOrganisers: collaborators.map((row) => name(row.user.name)) };
});
