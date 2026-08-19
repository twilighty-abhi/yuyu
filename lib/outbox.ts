import "server-only";

import { OutboxStatus, Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendRSVPConfirmation } from "@/lib/email";

type OutboxClient = Prisma.TransactionClient | typeof prisma;

type RsvpConfirmationPayload = {
  to: string;
  eventTitle: string;
  status: RsvpStatus;
  checkInToken: string;
};

export async function enqueueRsvpConfirmation(
  client: OutboxClient,
  payload: RsvpConfirmationPayload,
) {
  return client.outboxMessage.create({
    data: {
      kind: "rsvp-confirmation",
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

function asRsvpConfirmationPayload(value: Prisma.JsonValue): RsvpConfirmationPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.to !== "string" ||
    typeof payload.eventTitle !== "string" ||
    typeof payload.checkInToken !== "string" ||
    !Object.values(RsvpStatus).includes(payload.status as RsvpStatus)
  ) {
    return null;
  }
  return payload as RsvpConfirmationPayload;
}

/** Deliver a small batch. Run this from a protected scheduler, never a request path. */
export async function deliverOutboxBatch(limit = 20) {
  // A worker may be interrupted after claiming a message. Return a stale claim
  // to the retry queue before processing new work so messages cannot be lost.
  await prisma.outboxMessage.updateMany({
    where: {
      status: OutboxStatus.PROCESSING,
      lockedAt: { lt: new Date(Date.now() - 15 * 60_000) },
    },
    data: { status: OutboxStatus.PENDING, lockedAt: null },
  });

  const messages = await prisma.outboxMessage.findMany({
    where: { status: OutboxStatus.PENDING, availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });

  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    const claim = await prisma.outboxMessage.updateMany({
      where: { id: message.id, status: OutboxStatus.PENDING },
      data: { status: OutboxStatus.PROCESSING, lockedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;

    try {
      const payload = asRsvpConfirmationPayload(message.payload);
      if (!payload || message.kind !== "rsvp-confirmation") {
        throw new Error("Unsupported outbox message");
      }
      await sendRSVPConfirmation(payload);
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: { status: OutboxStatus.SENT, sentAt: new Date(), lastError: null },
      });
      sent += 1;
    } catch (error) {
      const attempts = message.attempts + 1;
      const retryAt = new Date(Date.now() + Math.min(60 * 60_000, 2 ** attempts * 60_000));
      await prisma.outboxMessage.update({
        where: { id: message.id },
        data: {
          status: attempts >= 8 ? OutboxStatus.FAILED : OutboxStatus.PENDING,
          availableAt: retryAt,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "Delivery failed",
        },
      });
      failed += 1;
    }
  }
  return { sent, failed };
}
