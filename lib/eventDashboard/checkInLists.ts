import "server-only";

import { cache } from "react";
import type { RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isEligibleForListCount } from "@/lib/checkInLists";
import type { CheckInListSummary } from "@/lib/core/checkinLists";

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

export const MAX_LIST_ROSTER = 500;

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

/**
 * The per-list guest view: every confirmed guest plus anyone already in the
 * list (for example a waitlisted guest admitted with Override), newest
 * check-ins first, then by name. Capped for the browser.
 */
export async function loadCheckInListRoster(eventId: string, list: { id: string; requiresEntryCheckIn: boolean }) {
  const rsvps = await prisma.rSVP.findMany({
    where: { eventId, OR: [{ status: "CONFIRMED" }, { checkInListRecords: { some: { listId: list.id } } }] },
    select: {
      id: true,
      status: true,
      checkedInAt: true,
      guestName: true,
      guestEmail: true,
      user: { select: { name: true, email: true } },
      checkInListRecords: { where: { listId: list.id }, select: { checkedInAt: true } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_LIST_ROSTER + 1,
  });
  const rows: ListRosterRow[] = rsvps.slice(0, MAX_LIST_ROSTER).map((rsvp) => ({
    rsvpId: rsvp.id,
    displayName: rsvp.user?.name?.trim() || rsvp.guestName?.trim() || rsvp.user?.email || rsvp.guestEmail || "Guest",
    email: rsvp.user?.email ?? rsvp.guestEmail,
    status: rsvp.status,
    entryCheckedInAt: rsvp.checkedInAt?.toISOString() ?? null,
    listCheckedInAt: rsvp.checkInListRecords[0]?.checkedInAt.toISOString() ?? null,
    eligible: isEligibleForListCount({ status: rsvp.status, entryCheckedInAt: rsvp.checkedInAt }, list),
  }));
  rows.sort((a, b) => {
    if (a.listCheckedInAt && b.listCheckedInAt) return b.listCheckedInAt.localeCompare(a.listCheckedInAt);
    if (a.listCheckedInAt) return -1;
    if (b.listCheckedInAt) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return { rows, truncated: rsvps.length > MAX_LIST_ROSTER };
}
