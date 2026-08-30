import "server-only";

import type { RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

type CheckInSource = "online" | "offline-sync" | "venue-station";

export type CheckInCommitResult =
  | { state: "checked-in"; checkedInAt: Date }
  | { state: "already-checked-in"; checkedInAt: Date }
  | { state: "ineligible"; status: RsvpStatus }
  | { state: "missing" };

/**
 * Atomically combines current eligibility, the RSVP projection, and immutable
 * history. A status transition or cancellation racing the scan cannot be
 * admitted using a stale preview.
 */
export function commitCheckInProjection(params: {
  rsvpId: string;
  actorUserId: string | null;
  source: CheckInSource;
  checkedInAt: Date;
  force: boolean;
}): Promise<CheckInCommitResult> {
  return prisma.$transaction(async (tx) => {
    const allowedStatuses = params.force
      ? ["CONFIRMED", "WAITLISTED", "PENDING_APPROVAL"] as const
      : ["CONFIRMED"] as const;
    const updated = await tx.rSVP.updateMany({
      where: { id: params.rsvpId, checkedInAt: null, status: { in: [...allowedStatuses] } },
      data: { checkedInAt: params.checkedInAt },
    });
    if (updated.count === 1) {
      await tx.checkInEvent.create({
        data: {
          rsvpId: params.rsvpId,
          actorUserId: params.actorUserId,
          action: "CHECKED_IN",
          source: params.source,
          occurredAt: params.checkedInAt,
        },
      });
      return { state: "checked-in", checkedInAt: params.checkedInAt };
    }
    const current = await tx.rSVP.findUnique({ where: { id: params.rsvpId }, select: { checkedInAt: true, status: true } });
    if (!current) return { state: "missing" };
    if (current.checkedInAt) return { state: "already-checked-in", checkedInAt: current.checkedInAt };
    return { state: "ineligible", status: current.status };
  });
}

export function commitUndoCheckInProjection(params: {
  rsvpId: string;
  actorUserId: string | null;
  source: "online" | "venue-station";
}) {
  return prisma.$transaction(async (tx) => {
    const changed = await tx.rSVP.updateMany({
      where: { id: params.rsvpId, checkedInAt: { not: null } },
      data: { checkedInAt: null },
    });
    if (changed.count !== 1) return false;
    await tx.checkInEvent.create({
      data: {
        rsvpId: params.rsvpId,
        actorUserId: params.actorUserId,
        action: "CHECK_IN_UNDONE",
        source: params.source,
      },
    });
    return true;
  });
}
