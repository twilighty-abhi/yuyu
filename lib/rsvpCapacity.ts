import { EventStatus, Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { enqueueRsvpConfirmation, enqueueRsvpStatusNotification } from "@/lib/outbox";

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
  expectedStatuses: RsvpStatus[];
  /** Approval requests must not be confirmed after their event has ended or been unpublished. */
  requireOpen?: boolean;
  notification?: { to: string; eventTitle: string; checkInToken: string };
  /**
   * What to do when there is no room. By default the RSVP is left unchanged
   * and "full" is returned. "waitlist" instead moves it to WAITLISTED in the
   * same locked transaction and queues the waitlist email, so an organiser can
   * later promote it like any other waitlisted guest.
   */
  whenFull?: "reject" | "waitlist";
}): Promise<"confirmed" | "waitlisted" | "full" | "changed" | "closed"> {
  const target = params.eventId ? { eventId: params.eventId } : { eventInstanceId: params.eventInstanceId! };
  return prisma.$transaction(async (tx) => {
    let capacity: number | null;
    let isOpen: boolean;
    if (params.eventId) {
      const events = await tx.$queryRaw<Array<{ capacity: number | null; status: EventStatus; endDateTime: Date }>>`
        SELECT "capacity", "status", "endDateTime" FROM "Event" WHERE "id" = ${params.eventId} FOR UPDATE
      `;
      const event = events[0];
      if (!event) return "changed";
      capacity = event.capacity;
      isOpen = event.status === EventStatus.PUBLISHED && event.endDateTime > new Date();
    } else {
      const instances = await tx.$queryRaw<Array<{ capacity: number | null; status: EventStatus; endDateTime: Date }>>`
        SELECT s."capacity", s."status", i."endDateTime"
        FROM "EventSeries" s
        INNER JOIN "EventInstance" i ON i."eventSeriesId" = s."id"
        WHERE i."id" = ${params.eventInstanceId}
        FOR UPDATE OF s, i
      `;
      const instance = instances[0];
      if (!instance) return "changed";
      capacity = instance.capacity;
      isOpen = instance.status === EventStatus.PUBLISHED && instance.endDateTime > new Date();
    }
    if (params.requireOpen && !isOpen) return "closed";
    const confirmed = await tx.rSVP.count({ where: { ...target, status: RsvpStatus.CONFIRMED } });
    if (capacity != null && confirmed >= capacity) {
      if (params.whenFull !== "waitlist") return "full";
      const waitlisted = await tx.rSVP.updateMany({
        where: { id: params.rsvpId, ...target, status: { in: params.expectedStatuses } },
        data: { status: RsvpStatus.WAITLISTED },
      });
      if (waitlisted.count === 1 && params.notification) {
        await enqueueRsvpConfirmation(tx, { ...params.notification, status: RsvpStatus.WAITLISTED });
      }
      return waitlisted.count === 1 ? "waitlisted" : "changed";
    }
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
