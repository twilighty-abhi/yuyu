import "server-only";

import { cache } from "react";
import type { Prisma, RsvpStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isEligibleForListCount } from "@/lib/checkInLists";
import type { CheckInListSummary } from "@/lib/core/checkinLists";
import { decodeTimeCursor, encodeTimeCursor } from "@/lib/keysetCursor";
import { containsText } from "@/lib/attendeeListQuery";

/*
 * Read models for custom check-in lists on the Check-in tab and the check-in
 * desk page. Callers must already hold `canCheckInToLists` or
 * `canManageCheckInLists` for the event; only names, counts and attendance
 * leave this module (no ticket tokens, no answers).
 */

export type CheckInListView = CheckInListSummary & {
  /** Guests checked into this list. */
  collected: number;
  /** Confirmed guests, or confirmed guests already checked in at entry when the list requires it. */
  eligible: number;
};

export const loadCheckInLists = cache(async (eventId: string): Promise<CheckInListView[]> => {
  const [lists, confirmed, confirmedAtEntry, collected] = await Promise.all([
    prisma.checkInList.findMany({
      where: { eventId },
      orderBy: [{ archived: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, sortOrder: true, archived: true, requiresEntryCheckIn: true },
    }),
    prisma.rSVP.count({ where: { eventId, status: "CONFIRMED" } }),
    prisma.rSVP.count({ where: { eventId, status: "CONFIRMED", checkedInAt: { not: null } } }),
    prisma.checkInListRecord.groupBy({ by: ["listId"], where: { list: { eventId } }, _count: { _all: true } }),
  ]);
  const collectedByList = new Map(collected.map((row) => [row.listId, row._count._all]));
  return lists.map((list) => ({
    ...list,
    collected: collectedByList.get(list.id) ?? 0,
    eligible: list.requiresEntryCheckIn ? confirmedAtEntry : confirmed,
  }));
});

/** Guests per page in "Guests for <list>"; "Show more" fetches the next one. */
export const LIST_ROSTER_PAGE_SIZE = 100;

export const LIST_ROSTER_FILTERS = ["all", "collected", "notCollected"] as const;
export type ListRosterFilter = (typeof LIST_ROSTER_FILTERS)[number];

export const listRosterViewSchema = z
  .object({
    filter: z.enum(LIST_ROSTER_FILTERS).optional().default("all"),
    query: z.string().trim().max(100).optional().default(""),
    cursor: z.string().trim().max(160).nullable().optional(),
  })
  .strict();

export type ListRosterRow = {
  rsvpId: string;
  displayName: string;
  email: string | null;
  status: RsvpStatus;
  entryCheckedInAt: string | null;
  listCheckedInAt: string | null;
  /** Counted in the list's "eligible" number. */
  eligible: boolean;
};

export type ListRosterPage = {
  rows: ListRosterRow[];
  nextCursor: string | null;
  /** Chip counts under the current search (first page only). */
  counts: Record<ListRosterFilter, number> | null;
};

/**
 * The per-list guest view: every confirmed guest plus anyone already in the
 * list (for example a waitlisted guest admitted with Override), in
 * registration order (`createdAt, id` keyset), filtered, searched and
 * counted in PostgreSQL. The first page also carries the chip counts.
 */
export async function loadCheckInListRosterPage(eventId: string, list: { id: string; requiresEntryCheckIn: boolean }, input: unknown = {}): Promise<ListRosterPage> {
  const empty: ListRosterPage = { rows: [], nextCursor: null, counts: null };
  const parsed = listRosterViewSchema.safeParse(input ?? {});
  if (!parsed.success) return empty;
  const { filter, query, cursor } = parsed.data;
  const after = cursor ? decodeTimeCursor(cursor) : null;
  if (cursor && !after) return empty;

  const inList: Prisma.RSVPWhereInput = { checkInListRecords: { some: { listId: list.id } } };
  const notInList: Prisma.RSVPWhereInput = { status: "CONFIRMED", checkInListRecords: { none: { listId: list.id } } };
  const and: Prisma.RSVPWhereInput[] = [{ eventId, OR: [{ status: "CONFIRMED" }, inList] }];
  if (query) {
    const contains = containsText(query);
    and.push({ OR: [{ guestName: contains }, { guestEmail: contains }, { user: { name: contains } }, { user: { email: contains } }] });
  }
  const base: Prisma.RSVPWhereInput = { AND: and };
  const filtered: Prisma.RSVPWhereInput = filter === "collected" ? { AND: [base, inList] } : filter === "notCollected" ? { AND: [base, notInList] } : base;

  const [rsvps, counts] = await Promise.all([
    prisma.rSVP.findMany({
      where: after ? { AND: [filtered, { OR: [{ createdAt: { gt: after.at } }, { createdAt: after.at, id: { gt: after.id } }] }] } : filtered,
      select: {
        id: true,
        status: true,
        createdAt: true,
        checkedInAt: true,
        guestName: true,
        guestEmail: true,
        user: { select: { name: true, email: true } },
        checkInListRecords: { where: { listId: list.id }, select: { checkedInAt: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: LIST_ROSTER_PAGE_SIZE + 1,
    }),
    cursor
      ? Promise.resolve(null)
      : Promise.all([
          prisma.rSVP.count({ where: base }),
          prisma.rSVP.count({ where: { AND: [base, inList] } }),
          prisma.rSVP.count({ where: { AND: [base, notInList] } }),
        ]).then(([all, collected, notCollected]) => ({ all, collected, notCollected })),
  ]);
  const page = rsvps.slice(0, LIST_ROSTER_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((rsvp) => ({
      rsvpId: rsvp.id,
      displayName: rsvp.user?.name?.trim() || rsvp.guestName?.trim() || rsvp.user?.email || rsvp.guestEmail || "Guest",
      email: rsvp.user?.email ?? rsvp.guestEmail,
      status: rsvp.status,
      entryCheckedInAt: rsvp.checkedInAt?.toISOString() ?? null,
      listCheckedInAt: rsvp.checkInListRecords[0]?.checkedInAt.toISOString() ?? null,
      eligible: isEligibleForListCount({ status: rsvp.status, entryCheckedInAt: rsvp.checkedInAt }, list),
    })),
    nextCursor: rsvps.length > LIST_ROSTER_PAGE_SIZE && last ? encodeTimeCursor({ at: last.createdAt, id: last.id }) : null,
    counts,
  };
}
