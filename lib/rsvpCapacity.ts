import { Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueRsvpStatusNotification } from "@/lib/outbox";

export async function countConfirmedForEvent(eventId: string): Promise<number> {
  return prisma.rSVP.count({
    where: { eventId, status: RsvpStatus.CONFIRMED },
  });
}

export async function countConfirmedForInstance(
  eventInstanceId: string,
): Promise<number> {
  return prisma.rSVP.count({
    where: { eventInstanceId, status: RsvpStatus.CONFIRMED },
  });
}

/** Caller must already be inside the restore transaction. Uses the same target
 * row lock as new reservations so an undo cannot race a final-slot claim. */
export async function hasCapacityToRestoreConfirmedRsvp(
  tx: Prisma.TransactionClient,
  target: { eventId: string } | { eventInstanceId: string },
): Promise<boolean> {
  let capacity: number | null;
  if ("eventId" in target) {
    const rows = await tx.$queryRaw<Array<{ capacity: number | null }>>`
      SELECT "capacity" FROM "Event" WHERE "id" = ${target.eventId} FOR UPDATE
    `;
    if (!rows[0]) return false;
    capacity = rows[0].capacity;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "EventInstance" WHERE "id" = ${target.eventInstanceId} FOR UPDATE`;
    const instance = await tx.eventInstance.findUnique({
      where: { id: target.eventInstanceId },
      select: { series: { select: { capacity: true } } },
    });
    if (!instance) return false;
    capacity = instance.series.capacity;
  }
  if (capacity == null) return true;
  const confirmed = await tx.rSVP.count({ where: { ...target, status: RsvpStatus.CONFIRMED } });
  return confirmed < capacity;
}

/** Atomically promote/approve an RSVP without exceeding the configured capacity. */
export async function confirmRsvpWithinCapacity(params: {
  rsvpId: string;
  eventId?: string;
  eventInstanceId?: string;
  capacity: number | null;
  expectedStatuses: RsvpStatus[];
  notification?: { to: string; eventTitle: string; checkInToken: string };
}): Promise<"confirmed" | "full" | "changed"> {
  const target = params.eventId ? { eventId: params.eventId } : { eventInstanceId: params.eventInstanceId! };
  return prisma.$transaction(async (tx) => {
    if (params.eventId) {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${params.eventId} FOR UPDATE`;
    } else {
      await tx.$queryRaw`SELECT "id" FROM "EventInstance" WHERE "id" = ${params.eventInstanceId} FOR UPDATE`;
    }
    const confirmed = await tx.rSVP.count({ where: { ...target, status: RsvpStatus.CONFIRMED } });
    if (params.capacity != null && confirmed >= params.capacity) return "full";
    const updated = await tx.rSVP.updateMany({
      where: { id: params.rsvpId, ...target, status: { in: params.expectedStatuses } },
      data: { status: RsvpStatus.CONFIRMED },
    });
    if (updated.count === 1 && params.notification) {
      await enqueueRsvpStatusNotification(tx, {
        ...params.notification,
        approved: true,
      });
    }
    return updated.count === 1 ? "confirmed" : "changed";
  });
}
