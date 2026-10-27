import "server-only";

import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ATTENDEES_PAGE_SIZE,
  ATTENDEE_ATTENDANCE_FILTERS,
  ATTENDEE_ORDER,
  ATTENDEE_STATUS_FILTERS,
  attendanceBadgeState,
  attendeeAttendanceWhere,
  attendeeBaseWhere,
  attendeeCursorWhere,
  attendeeListViewSchema,
  attendeeScopeWhere,
  attendeeStatusWhere,
  type AttendeeAttendanceFilter,
  type AttendeeScope,
  type AttendeeStatusFilter,
} from "@/lib/attendeeListQuery";
import { encodeTimeCursor } from "@/lib/keysetCursor";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";

/*
 * Guests · People, one bounded page at a time (docs/TEAMS.md). Filters,
 * search and the chip counts all run in PostgreSQL, so every registration
 * can be found however many there are. Callers must have authorised the
 * scope for registration management (`canManageRegistrationsFor`); the
 * scope's organisation is re-checked inside each query.
 */

const attendeeInclude = {
  user: { select: { id: true, name: true, email: true } },
  answers: { include: { field: true } },
  team: { select: { id: true, name: true, leaderRsvpId: true } },
  checkInListRecords: { select: { checkedInAt: true, list: { select: { name: true, archived: true } } }, orderBy: { list: { sortOrder: "asc" } } },
  // Attendance confirmation reply only; the check's token hash is never read.
  attendanceCheck: { select: { response: true, respondedAt: true, note: true } },
} satisfies Prisma.RSVPInclude;

type AttendeeRecord = Prisma.RSVPGetPayload<{ include: typeof attendeeInclude }>;

/** One registration as GuestRow and EditRsvpDialog receive it. */
export function toAttendeeRow(rsvp: AttendeeRecord, origin: string, options: { attendanceAsked?: boolean } = {}) {
  return {
    id: rsvp.id,
    status: rsvp.status,
    createdAt: rsvp.createdAt.toISOString(),
    guestEmail: rsvp.guestEmail,
    guestName: rsvp.guestName,
    user: rsvp.user ? { id: rsvp.user.id, name: rsvp.user.name, email: rsvp.user.email } : null,
    checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
    /** An event crew ticket: managed in Guests → Crew, never edited or removed here. */
    isCrew: rsvp.isCrew,
    /** Custom check-in lists this guest is in (never changes entry check-in). */
    listCheckIns: rsvp.checkInListRecords.map((record) => ({
      listName: record.list.archived ? `${record.list.name} (archived)` : record.list.name,
      checkedInAt: record.checkedInAt.toISOString(),
    })),
    ticketUrl: `${origin}/ticket/${rsvp.checkInToken}`,
    // TEAM events: the team this registration belongs to (null when solo).
    team: rsvp.team ? { id: rsvp.team.id, name: rsvp.team.name, isLeader: rsvp.team.leaderRsvpId === rsvp.id } : null,
    // Attendance confirmation badge (null: nothing to show) and the guest's optional note.
    attendance: {
      state: attendanceBadgeState(rsvp, { showNotAsked: options.attendanceAsked ?? false }),
      note: rsvp.attendanceCheck?.note || null,
      respondedAt: rsvp.attendanceCheck?.respondedAt?.toISOString() ?? null,
    },
    rawAnswers: rsvp.answers.map((answer) => ({
      fieldId: answer.fieldId,
      valueText: answer.valueText,
      valueBool: answer.valueBool,
      valueNumber: answer.valueNumber,
      valueDate: answer.valueDate?.toISOString() ?? null,
    })),
    answers: (() => {
      const byField: Record<string, { label: string; values: string[] }> = {};
      for (const answer of rsvp.answers) {
        const value =
          answer.valueText ??
          (answer.valueBool != null ? (answer.valueBool ? "Yes" : "No") : null) ??
          (answer.valueNumber != null ? String(answer.valueNumber) : null) ??
          (answer.valueDate != null ? new Date(answer.valueDate).toLocaleDateString() : null);
        if (!value) continue;
        if (!byField[answer.field.id]) byField[answer.field.id] = { label: answer.field.label, values: [] };
        byField[answer.field.id]!.values.push(value);
      }
      return Object.values(byField).map((entry) => ({ label: entry.label, value: entry.values.join(", ") }));
    })(),
  };
}

export type AttendeeRowDto = ReturnType<typeof toAttendeeRow>;
export type AttendeeFilterCounts = Record<AttendeeStatusFilter, number>;
export type AttendeeAttendanceCounts = Record<AttendeeAttendanceFilter, number>;

export type AttendeesPage = {
  rows: AttendeeRowDto[];
  nextCursor: string | null;
  /** Per-chip counts for the whole scope, ignoring search and filters (first page only). */
  counts: AttendeeFilterCounts | null;
  /** Every registration in the scope, ignoring filters (first page only). */
  total: number | null;
  /** Registrations matching the current search, dropdowns and status chip (first page only). */
  matching: number | null;
  /**
   * Attendance reply counts under the current search, dropdowns and status
   * chip (first page of a one-off event only; null otherwise). Null too until
   * someone at the event has been asked, so the filter stays hidden.
   */
  attendanceCounts: AttendeeAttendanceCounts | null;
};

const EMPTY_PAGE: AttendeesPage = { rows: [], nextCursor: null, counts: null, total: null, matching: null, attendanceCounts: null };

/** The chip counts: one grouped count by status plus the checked-in counts, under the given condition. */
export async function countAttendeeFilters(base: Prisma.RSVPWhereInput): Promise<AttendeeFilterCounts> {
  const [groups, checkedIn, notCheckedIn] = await Promise.all([
    prisma.rSVP.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    prisma.rSVP.count({ where: { AND: [base, attendeeStatusWhere("checkedIn")] } }),
    prisma.rSVP.count({ where: { AND: [base, attendeeStatusWhere("notCheckedIn")] } }),
  ]);
  const of = (status: string) => groups.find((group) => group.status === status)?._count._all ?? 0;
  const counts = Object.fromEntries(ATTENDEE_STATUS_FILTERS.map((filter) => [filter, 0])) as AttendeeFilterCounts;
  counts.all = groups.reduce((sum, group) => sum + group._count._all, 0);
  counts.going = of("CONFIRMED");
  counts.waitlist = of("WAITLISTED");
  counts.approve = of("PENDING_APPROVAL");
  counts.declined = of("REJECTED");
  counts.checkedIn = checkedIn;
  counts.notCheckedIn = notCheckedIn;
  return counts;
}

/** Attendance reply counts: one count per filter under the same condition. */
export async function countAttendanceFilters(base: Prisma.RSVPWhereInput): Promise<AttendeeAttendanceCounts> {
  const entries = await Promise.all(
    ATTENDEE_ATTENDANCE_FILTERS.map(async (filter) => [filter, await prisma.rSVP.count({ where: { AND: [base, attendeeAttendanceWhere(filter)] } })] as const),
  );
  return Object.fromEntries(entries) as AttendeeAttendanceCounts;
}

/** Whether anyone registered for this one-off event has been asked to confirm attendance. */
async function attendanceAskedFor(scope: AttendeeScope): Promise<boolean> {
  if (scope.kind !== "event") return false;
  const any = await prisma.attendanceCheck.findFirst({ where: { eventId: scope.eventId, event: { organisationId: scope.organisationId } }, select: { id: true } });
  return any != null;
}

/**
 * One page of the People list for a validated view. The first page (no
 * cursor) also carries the chip counts (always the whole event or date, so
 * they never shrink with the search or dropdowns), the unfiltered total and
 * how many registrations match the view; "Load more" pages skip those queries. A malformed view or cursor returns an empty page.
 */
export async function listAttendeesPage(scope: AttendeeScope, input: unknown, options: { origin: string; teamMode: boolean }): Promise<AttendeesPage> {
  const parsed = attendeeListViewSchema.safeParse(input ?? {});
  if (!parsed.success) return EMPTY_PAGE;
  const view = parsed.data;
  const after = attendeeCursorWhere(view.cursor);
  if (!after) return EMPTY_PAGE;
  const base = attendeeBaseWhere(scope, view, { teamMode: options.teamMode });
  const firstPage = !view.cursor;
  const attendanceAsked = await attendanceAskedFor(scope);
  // The attendance counts describe every other filter (status chip included) but not their own dropdown.
  const attendanceBase = { AND: [attendeeBaseWhere(scope, { ...view, attendance: "all" }, { teamMode: options.teamMode }), attendeeStatusWhere(view.status)] };
  const viewWhere = { AND: [base, attendeeStatusWhere(view.status)] };
  const [records, counts, matching, attendanceCounts] = await Promise.all([
    prisma.rSVP.findMany({
      where: { AND: [viewWhere, after] },
      include: attendeeInclude,
      orderBy: ATTENDEE_ORDER,
      take: ATTENDEES_PAGE_SIZE + 1,
    }),
    firstPage ? countAttendeeFilters(attendeeScopeWhere(scope)) : Promise.resolve(null),
    firstPage ? prisma.rSVP.count({ where: viewWhere }) : Promise.resolve(null),
    firstPage && attendanceAsked ? countAttendanceFilters(attendanceBase) : Promise.resolve(null),
  ]);
  const page = records.slice(0, ATTENDEES_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((record) => toAttendeeRow(record, options.origin, { attendanceAsked })),
    nextCursor: records.length > ATTENDEES_PAGE_SIZE && last ? encodeTimeCursor({ at: last.createdAt, id: last.id }) : null,
    counts,
    total: counts?.all ?? null,
    matching,
    attendanceCounts,
  };
}

/** The first, unfiltered page for the event dashboard (registration managers only). */
export const loadAttendeesFirstPage = cache(async (ctx: EventDashboardContext): Promise<AttendeesPage> =>
  listAttendeesPage(
    { kind: "event", eventId: ctx.event.id, organisationId: ctx.organisation.id },
    {},
    { origin: ctx.origin, teamMode: ctx.event.registrationMode === "TEAM" },
  ),
);
