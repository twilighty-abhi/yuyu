import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { decodeTimeCursor } from "@/lib/keysetCursor";

/*
 * The Guests · People list query, shared by the dashboard loader, its
 * `loadAttendeesPage` action and the filtered email export. Pure: it builds
 * Prisma conditions from a validated view; callers add the scope (an event
 * or occurrence the caller has already been authorised for).
 */

/** Registrations per page in Guests · People; "Load more" fetches the next one. */
export const ATTENDEES_PAGE_SIZE = 50;

export const ATTENDEE_STATUS_FILTERS = ["all", "going", "waitlist", "approve", "declined", "checkedIn"] as const;
export const ATTENDEE_KIND_FILTERS = ["all", "guests", "users"] as const;
export const ATTENDEE_TEAM_FILTERS = ["all", "team", "solo"] as const;

export type AttendeeStatusFilter = (typeof ATTENDEE_STATUS_FILTERS)[number];
export type AttendeeKindFilter = (typeof ATTENDEE_KIND_FILTERS)[number];
export type AttendeeTeamFilter = (typeof ATTENDEE_TEAM_FILTERS)[number];

export const attendeeListViewSchema = z
  .object({
    query: z.string().trim().max(100).optional().default(""),
    status: z.enum(ATTENDEE_STATUS_FILTERS).optional().default("all"),
    kind: z.enum(ATTENDEE_KIND_FILTERS).optional().default("all"),
    team: z.enum(ATTENDEE_TEAM_FILTERS).optional().default("all"),
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
  }
}

/**
 * Everything but the status chip: the scope, guests-or-users, team-or-solo
 * (TEAM events only) and the search over names, emails and, on TEAM events,
 * the team name (matched inside the scoped event only). The chip counts use
 * this condition so they describe the current search.
 */
export function attendeeBaseWhere(scope: AttendeeScope, view: Pick<AttendeeListView, "query" | "kind" | "team">, options: { teamMode: boolean }): Prisma.RSVPWhereInput {
  const and: Prisma.RSVPWhereInput[] = [attendeeScopeWhere(scope)];
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
export function attendeeViewSearchParams(view: Pick<AttendeeListView, "query" | "status" | "kind" | "team">): string {
  const params = new URLSearchParams();
  if (view.status !== "all") params.set("status", view.status);
  if (view.kind !== "all") params.set("kind", view.kind);
  if (view.team !== "all") params.set("team", view.team);
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
  });
  return parsed.success ? { ...parsed.data, cursor: null } : null;
}
