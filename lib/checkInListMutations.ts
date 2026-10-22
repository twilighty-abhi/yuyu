import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CheckInGate } from "@/lib/checkIn";
import { gateListCheckIn, type CheckInListSource } from "@/lib/checkInLists";

export type ListCheckInCommitResult =
  | { state: "checked-in"; checkedInAt: Date }
  | { state: "already-checked-in"; checkedInAt: Date }
  | { state: "ineligible"; gate: Extract<CheckInGate, { ok: false }> }
  | { state: "missing" };

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Checks one registration into one custom list. Eligibility, the record and
 * its immutable history are one transaction: the RSVP row is locked (so a
 * status change or a parallel scan cannot slip between the check and the
 * write) and the list row is share-locked (so it cannot be archived
 * mid-scan). The `(listId, rsvpId)` unique index is the final guard.
 *
 * List check-ins never touch `RSVP.checkedInAt`, `CheckInEvent`, or the
 * realtime ticket channel; entry check-in stays exactly as it was.
 */
export async function commitListCheckIn(params: {
  listId: string;
  rsvpId: string;
  actorUserId: string | null;
  source: CheckInListSource;
  checkedInAt: Date;
  force: boolean;
}): Promise<ListCheckInCommitResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<ListCheckInCommitResult> => {
      await tx.$queryRaw`SELECT "id" FROM "RSVP" WHERE "id" = ${params.rsvpId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "CheckInList" WHERE "id" = ${params.listId} FOR SHARE`;
      const [rsvp, list, existing] = await Promise.all([
        tx.rSVP.findUnique({ where: { id: params.rsvpId }, select: { status: true, checkedInAt: true, eventId: true } }),
        tx.checkInList.findUnique({ where: { id: params.listId }, select: { eventId: true, name: true, archived: true, requiresEntryCheckIn: true } }),
        tx.checkInListRecord.findUnique({ where: { listId_rsvpId: { listId: params.listId, rsvpId: params.rsvpId } }, select: { checkedInAt: true } }),
      ]);
      if (!rsvp || !list || rsvp.eventId !== list.eventId) return { state: "missing" };
      if (list.archived) {
        return { state: "ineligible", gate: { ok: false, reason: "This list is archived and read-only.", needsForce: false, blocked: true } };
      }
      if (existing) return { state: "already-checked-in", checkedInAt: existing.checkedInAt };
      const gate = gateListCheckIn({ status: rsvp.status, entryCheckedInAt: rsvp.checkedInAt, force: params.force, list });
      if (!gate.ok) return { state: "ineligible", gate };
      await tx.checkInListRecord.create({
        data: { listId: params.listId, rsvpId: params.rsvpId, actorUserId: params.actorUserId, source: params.source, checkedInAt: params.checkedInAt },
      });
      await tx.checkInListEvent.create({
        data: { listId: params.listId, rsvpId: params.rsvpId, actorUserId: params.actorUserId, action: "CHECKED_IN", source: params.source, occurredAt: params.checkedInAt },
      });
      return { state: "checked-in", checkedInAt: params.checkedInAt };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Defence in depth: the row lock already serialises scans of one RSVP.
    const existing = await prisma.checkInListRecord.findUnique({ where: { listId_rsvpId: { listId: params.listId, rsvpId: params.rsvpId } }, select: { checkedInAt: true } });
    if (!existing) throw error;
    return { state: "already-checked-in", checkedInAt: existing.checkedInAt };
  }
}

export type ListUndoCommitResult = "undone" | "not-checked-in" | "archived" | "missing";

/** Removes one list check-in and records the undo. Archived lists are read-only. */
export function commitUndoListCheckIn(params: { listId: string; rsvpId: string; actorUserId: string | null; source: CheckInListSource }): Promise<ListUndoCommitResult> {
  return prisma.$transaction(async (tx): Promise<ListUndoCommitResult> => {
    await tx.$queryRaw`SELECT "id" FROM "CheckInList" WHERE "id" = ${params.listId} FOR SHARE`;
    const list = await tx.checkInList.findUnique({ where: { id: params.listId }, select: { archived: true } });
    if (!list) return "missing";
    if (list.archived) return "archived";
    const removed = await tx.checkInListRecord.deleteMany({ where: { listId: params.listId, rsvpId: params.rsvpId } });
    if (removed.count !== 1) return "not-checked-in";
    await tx.checkInListEvent.create({
      data: { listId: params.listId, rsvpId: params.rsvpId, actorUserId: params.actorUserId, action: "CHECK_IN_UNDONE", source: params.source },
    });
    return "undone";
  });
}
