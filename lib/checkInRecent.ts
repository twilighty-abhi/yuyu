import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { decodeTimeCursor, encodeTimeCursor } from "@/lib/keysetCursor";

/*
 * "Recent check-ins" on the check-in desk and the PIN-unlocked venue station:
 * newest first, keyset-paged on (checkedInAt, id). Names, emails and times
 * only (never ticket tokens). Callers must already have authorised the event
 * (CHECK_IN for the desk, a valid station proof for the station).
 */

export const RECENT_CHECK_INS_PAGE_SIZE = 25;

export const recentCheckInsCursorSchema = z.string().trim().max(160).nullable().optional();

export type RecentCheckInRow = { rsvpId: string; displayName: string; email: string | null; checkedInAt: string };
export type RecentCheckInsPage = { rows: RecentCheckInRow[]; nextCursor: string | null };

function label(r: { user: { name: string | null; email: string | null } | null; guestName: string | null; guestEmail: string | null }) {
  return r.user?.name?.trim() || r.guestName?.trim() || r.user?.email || r.guestEmail || "Guest";
}

/** One page of the event's check-ins, newest first. A malformed cursor returns an empty page. */
export async function listRecentCheckIns(eventId: string, cursor?: string | null): Promise<RecentCheckInsPage> {
  const after = cursor ? decodeTimeCursor(cursor) : null;
  if (cursor && !after) return { rows: [], nextCursor: null };
  const rsvps = await prisma.rSVP.findMany({
    where: {
      eventId,
      checkedInAt: { not: null },
      ...(after ? { OR: [{ checkedInAt: { lt: after.at } }, { checkedInAt: after.at, id: { lt: after.id } }] } : {}),
    },
    orderBy: [{ checkedInAt: "desc" }, { id: "desc" }],
    take: RECENT_CHECK_INS_PAGE_SIZE + 1,
    select: { id: true, checkedInAt: true, guestName: true, guestEmail: true, user: { select: { name: true, email: true } } },
  });
  const page = rsvps.slice(0, RECENT_CHECK_INS_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    rows: page.map((r) => ({ rsvpId: r.id, displayName: label(r), email: r.user?.email ?? r.guestEmail, checkedInAt: r.checkedInAt!.toISOString() })),
    nextCursor: rsvps.length > RECENT_CHECK_INS_PAGE_SIZE && last?.checkedInAt ? encodeTimeCursor({ at: last.checkedInAt, id: last.id }) : null,
  };
}
