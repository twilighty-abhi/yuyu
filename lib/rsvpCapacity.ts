import { RsvpStatus } from "@prisma/client";
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
