import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { decodeTimeCursor } from "@/lib/keysetCursor";
import { ATTENDANCE_STATE_LABELS, attendanceStateOf, type AttendanceResponseValue, type AttendanceState } from "@/lib/attendanceCheck";

/*
 * The Guests · People list query, shared by the dashboard loader, its
 * `loadAttendeesPage` action and the filtered email export. Pure: it builds
 * Prisma conditions from a validated view; callers add the scope (an event
 * or occurrence the caller has already been authorised for).
 */

/** Registrations per page in Guests · People; "Load more" fetches the next one. */
export const ATTENDEES_PAGE_SIZE = 50;

/** `notCheckedIn`: going (CONFIRMED) and not yet checked in at the door. */
export const ATTENDEE_STATUS_FILTERS = ["all", "going", "waitlist", "approve", "declined", "checkedIn", "notCheckedIn"] as const;
export const ATTENDEE_KIND_FILTERS = ["all", "guests", "users"] as const;
export const ATTENDEE_TEAM_FILTERS = ["all", "team", "solo"] as const;
/**
 * The attendance confirmation reply (docs/FEATURES.md, "Attendance
 * confirmation"); one-off events only. `noReply` and `notAsked` cover going
 * (CONFIRMED) guests only, matching the Emails card's counts; `coming` and
 * `notComing` keep a reply even if the registration changed since.
 */
export const ATTENDEE_ATTENDANCE_FILTERS = ["all", "coming", "notComing", "noReply", "notAsked"] as const;

export type AttendeeStatusFilter = (typeof ATTENDEE_STATUS_FILTERS)[number];
export type AttendeeKindFilter = (typeof ATTENDEE_KIND_FILTERS)[number];
export type AttendeeTeamFilter = (typeof ATTENDEE_TEAM_FILTERS)[number];
export type AttendeeAttendanceFilter = (typeof ATTENDEE_ATTENDANCE_FILTERS)[number];

export const attendeeListViewSchema = z
  .object({
    query: z.string().trim().max(100).optional().default(""),
    status: z.enum(ATTENDEE_STATUS_FILTERS).optional().default("all"),
    kind: z.enum(ATTENDEE_KIND_FILTERS).optional().default("all"),
    team: z.enum(ATTENDEE_TEAM_FILTERS).optional().default("all"),
    attendance: z.enum(ATTENDEE_ATTENDANCE_FILTERS).optional().default("all"),
    cursor: z.string().trim().max(160).nullable().optional(),
  })
  .strict();

export type AttendeeListView = z.infer<typeof attendeeListViewSchema>;

/**
 * A case-insensitive "contains" filter whose `%`, `_` and `\` match
 * literally (Prisma passes them through to LIKE as wildcards otherwise).
 */
export function containsText(text: string) {
  return { contains: text.replace(/[\\%_]/g, (char) => `\\${char}`), mode: "insensitive" as const };
}

/** Whose registrations: one standalone event, or one series occurrence. */
export type AttendeeScope =
  | { kind: "event"; eventId: string; organisationId: string }
  | { kind: "instance"; eventInstanceId: string; organisationId: string };

/** The scope as a Prisma condition, with the organisation re-checked in the same query. */
export function attendeeScopeWhere(scope: AttendeeScope): Prisma.RSVPWhereInput {
  return scope.kind === "event"
    ? { eventId: scope.eventId, event: { organisationId: scope.organisationId } }
    : { eventInstanceId: scope.eventInstanceId, eventInstance: { series: { organisationId: scope.organisationId } } };
}

/** One status chip as a condition ("all" adds nothing). */
export function attendeeStatusWhere(status: AttendeeStatusFilter): Prisma.RSVPWhereInput {
  switch (status) {
    case "all":
      return {};
    case "going":
      return { status: "CONFIRMED" };
    case "waitlist":
      return { status: "WAITLISTED" };
    case "approve":
      return { status: "PENDING_APPROVAL" };
    case "declined":
      return { status: "REJECTED" };
    case "checkedIn":
      return { checkedInAt: { not: null } };
    case "notCheckedIn":
      return { status: "CONFIRMED", checkedInAt: null };
  }
}

/** One attendance reply filter as a condition ("all" adds nothing). */
export function attendeeAttendanceWhere(attendance: AttendeeAttendanceFilter): Prisma.RSVPWhereInput {
  switch (attendance) {
    case "all":
      return {};
    case "coming":
      return { attendanceCheck: { is: { response: "ATTENDING" } } };
    case "notComing":
      return { attendanceCheck: { is: { response: "NOT_ATTENDING" } } };
    case "noReply":
      return { status: "CONFIRMED", attendanceCheck: { is: { response: null } } };
    case "notAsked":
      return { status: "CONFIRMED", attendanceCheck: { is: null } };
  }
}

/**
 * Everything but the status chip: the scope, guests-or-users, team-or-solo
 * (TEAM events only), the attendance reply (one-off events only) and the
 * search over names, emails and, on TEAM events, the team name (matched
 * inside the scoped event only). The list and exports use this condition;
 * the chip counts deliberately don't, so they always show the whole scope.
 */
export function attendeeBaseWhere(
  scope: AttendeeScope,
  view: Pick<AttendeeListView, "query" | "kind" | "team"> & { attendance?: AttendeeAttendanceFilter },
  options: { teamMode: boolean },
): Prisma.RSVPWhereInput {
  const and: Prisma.RSVPWhereInput[] = [attendeeScopeWhere(scope)];
  // Series occurrences are never asked, so the filter only applies to one-off events.
  if (scope.kind === "event" && view.attendance && view.attendance !== "all") and.push(attendeeAttendanceWhere(view.attendance));
  if (view.kind === "guests") and.push({ userId: null });
  if (view.kind === "users") and.push({ userId: { not: null } });
  if (options.teamMode && view.team === "team") and.push({ teamId: { not: null } });
  if (options.teamMode && view.team === "solo") and.push({ teamId: null });
  const q = view.query.trim();
  if (q) {
    const contains = containsText(q);
    const or: Prisma.RSVPWhereInput[] = [
      { guestName: contains },
      { guestEmail: contains },
      { user: { name: contains } },
      { user: { email: contains } },
    ];
    if (options.teamMode && scope.kind === "event") or.push({ team: { eventId: scope.eventId, name: contains } });
    and.push({ OR: or });
  }
  return { AND: and };
}

/** Newest first; `id` breaks ties so pages never skip or repeat a row. */
export const ATTENDEE_ORDER: Prisma.RSVPOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

/** Rows strictly after the cursor in ATTENDEE_ORDER, or null for a malformed cursor. */
export function attendeeCursorWhere(cursor: string | null | undefined): Prisma.RSVPWhereInput | null {
  if (!cursor) return {};
  const after = decodeTimeCursor(cursor);
  if (!after) return null;
  return { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] };
}

/** Query-string form of a view, for the filtered email export link. */
export function attendeeViewSearchParams(view: Pick<AttendeeListView, "query" | "status" | "kind" | "team"> & { attendance?: AttendeeAttendanceFilter }): string {
  const params = new URLSearchParams();
  if (view.status !== "all") params.set("status", view.status);
  if (view.kind !== "all") params.set("kind", view.kind);
  if (view.team !== "all") params.set("team", view.team);
  if (view.attendance && view.attendance !== "all") params.set("attendance", view.attendance);
  if (view.query.trim()) params.set("q", view.query.trim());
  return params.toString();
}

/** Parses the export link's query string back into a view (cursor never applies). */
export function parseAttendeeViewSearchParams(params: URLSearchParams): AttendeeListView | null {
  const parsed = attendeeListViewSchema.safeParse({
    query: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    kind: params.get("kind") ?? undefined,
    team: params.get("team") ?? undefined,
    attendance: params.get("attendance") ?? undefined,
  });
  return parsed.success ? { ...parsed.data, cursor: null } : null;
}

/**
 * The attendance badge for one registration, or null when there is nothing
 * to say: a guest who was never asked shows "Not asked" only while going
 * (CONFIRMED), and only when `showNotAsked` (someone at the event has been
 * asked; before the first send every going guest would carry it).
 */
export function attendanceBadgeState(
  rsvp: { status: string; attendanceCheck: { response: AttendanceResponseValue | null } | null | undefined },
  options: { showNotAsked?: boolean } = {},
): AttendanceState | null {
  if (rsvp.attendanceCheck) return attendanceStateOf(rsvp.attendanceCheck);
  return rsvp.status === "CONFIRMED" && options.showNotAsked !== false ? "notAsked" : null;
}

/**
 * The attendee CSV's "Attendance confirmation" and "Attendance note" cells,
 * with the same "Not asked" rule as the badge. Raw text: lib/csv.ts
 * neutralises formulas when the row is written.
 */
export function attendanceCsvCells(
  rsvp: { status: string; attendanceCheck: { response: AttendanceResponseValue | null; note: string | null } | null | undefined },
  options: { showNotAsked?: boolean } = {},
): [string, string] {
  const state = attendanceBadgeState(rsvp, options);
  return [state ? ATTENDANCE_STATE_LABELS[state] : "", rsvp.attendanceCheck?.note ?? ""];
}
