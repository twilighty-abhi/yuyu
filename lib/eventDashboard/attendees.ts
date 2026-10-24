import "server-only";

import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ATTENDEES_PAGE_SIZE,
  ATTENDEE_ORDER,
  ATTENDEE_STATUS_FILTERS,
  attendeeBaseWhere,
  attendeeCursorWhere,
  attendeeListViewSchema,
  attendeeScopeWhere,
  attendeeStatusWhere,
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
} satisfies Prisma.RSVPInclude;

type AttendeeRecord = Prisma.RSVPGetPayload<{ include: typeof attendeeInclude }>;

/** One registration as GuestRow and EditRsvpDialog receive it. */
export function toAttendeeRow(rsvp: AttendeeRecord, origin: string) {
  return {
    id: rsvp.id,
    status: rsvp.status,
    createdAt: rsvp.createdAt.toISOString(),
    guestEmail: rsvp.guestEmail,
    guestName: rsvp.guestName,
    user: rsvp.user ? { id: rsvp.user.id, name: rsvp.user.name, email: rsvp.user.email } : null,
    checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
    /** Custom check-in lists this guest is in (never changes entry check-in). */
    listCheckIns: rsvp.checkInListRecords.map((record) => ({
      listName: record.list.archived ? `${record.list.name} (archived)` : record.list.name,
      checkedInAt: record.checkedInAt.toISOString(),
    })),
    ticketUrl: `${origin}/ticket/${rsvp.checkInToken}`,
    // TEAM events: the team this registration belongs to (null when solo).
    team: rsvp.team ? { id: rsvp.team.id, name: rsvp.team.name, isLeader: rsvp.team.leaderRsvpId === rsvp.id } : null,
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

export type AttendeesPage = {
  rows: AttendeeRowDto[];
  nextCursor: string | null;
  /** Per-chip counts for the current search and dropdown filters (first page only). */
  counts: AttendeeFilterCounts | null;
  /** Every registration in the scope, ignoring filters (first page only). */
  total: number | null;
};

const EMPTY_PAGE: AttendeesPage = { rows: [], nextCursor: null, counts: null, total: null };

/** The chip counts: one grouped count by status plus the checked-in count, under the same search. */
export async function countAttendeeFilters(base: Prisma.RSVPWhereInput): Promise<AttendeeFilterCounts> {
  const [groups, checkedIn] = await Promise.all([
    prisma.rSVP.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    prisma.rSVP.count({ where: { AND: [base, { checkedInAt: { not: null } }] } }),
  ]);
  const of = (status: string) => groups.find((group) => group.status === status)?._count._all ?? 0;
  const counts = Object.fromEntries(ATTENDEE_STATUS_FILTERS.map((filter) => [filter, 0])) as AttendeeFilterCounts;
  counts.all = groups.reduce((sum, group) => sum + group._count._all, 0);
  counts.going = of("CONFIRMED");
  counts.waitlist = of("WAITLISTED");
  counts.approve = of("PENDING_APPROVAL");
  counts.declined = of("REJECTED");
  counts.checkedIn = checkedIn;
  return counts;
}

/**
 * One page of the People list for a validated view. The first page (no
 * cursor) also carries the chip counts and the unfiltered total; "Load more"
 * pages skip those queries. A malformed view or cursor returns an empty page.
 */
export async function listAttendeesPage(scope: AttendeeScope, input: unknown, options: { origin: string; teamMode: boolean }): Promise<AttendeesPage> {
  const parsed = attendeeListViewSchema.safeParse(input ?? {});
  if (!parsed.success) return EMPTY_PAGE;
  const view = parsed.data;
  const after = attendeeCursorWhere(view.cursor);
  if (!after) return EMPTY_PAGE;
  const base = attendeeBaseWhere(scope, view, { teamMode: options.teamMode });
  const firstPage = !view.cursor;
  const [records, counts, total] = await Promise.all([
    prisma.rSVP.findMany({
      where: { AND: [base, attendeeStatusWhere(view.status), after] },
      include: attendeeInclude,
      orderBy: ATTENDEE_ORDER,
      take: ATTENDEES_PAGE_SIZE + 1,
    }),
    firstPage ? countAttendeeFilters(base) : Promise.resolve(null),
    firstPage ? prisma.rSVP.count({ where: attendeeScopeWhere(scope) }) : Promise.resolve(null),
  ]);
  const page = records.slice(0, ATTENDEES_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((record) => toAttendeeRow(record, options.origin)),
    nextCursor: records.length > ATTENDEES_PAGE_SIZE && last ? encodeTimeCursor({ at: last.createdAt, id: last.id }) : null,
    counts,
    total,
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
