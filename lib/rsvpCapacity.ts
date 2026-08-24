import { Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

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

/** Atomically promote/approve an RSVP without exceeding the configured capacity. */
export async function confirmRsvpWithinCapacity(params: {
  rsvpId: string;
  eventId?: string;
  eventInstanceId?: string;
  capacity: number | null;
  expectedStatuses: RsvpStatus[];
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
    return updated.count === 1 ? "confirmed" : "changed";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
