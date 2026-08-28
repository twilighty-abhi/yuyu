import "server-only";

import { OutboxStatus, Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendApprovalNotification, sendCollaboratorInvitation, sendEventInvitation, sendRSVPConfirmation } from "@/lib/email";
import { sendPasswordResetEmail } from "@/lib/email/passwordReset";
import { sendEmailVerificationEmail } from "@/lib/email/emailVerification";
import { redactSensitiveText } from "@/lib/redactSensitiveText";

type OutboxClient = Prisma.TransactionClient | typeof prisma;

type RsvpConfirmationPayload = {
  to: string;
  eventTitle: string;
  status: RsvpStatus;
  checkInToken: string;
};

type RsvpStatusPayload = {
  to: string;
  eventTitle: string;
  approved: boolean;
  checkInToken?: string;
};

type PasswordResetPayload = {
  to: string;
  resetUrl: string;
  expiresAt: string;
};

type EventInvitePayload = {
  to: string;
  eventTitle: string;
  organisationName: string;
  orgSlug: string;
  eventSlug: string;
};

type EmailVerificationPayload = {
  to: string;
  verificationUrl: string;
  expiresAt: string;
};
type CollaboratorInvitePayload = { to: string; eventTitle: string; inviteUrl: string };

export async function enqueueCollaboratorInvite(client: OutboxClient, payload: CollaboratorInvitePayload) { return client.outboxMessage.create({ data: { kind: "collaborator-invite", payload: payload as Prisma.InputJsonValue } }); }

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

export async function enqueueRsvpStatusNotification(
  client: OutboxClient,
  payload: RsvpStatusPayload,
) {
  return client.outboxMessage.create({
    data: {
      kind: "rsvp-status",
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export async function enqueuePasswordReset(
  client: OutboxClient,
  payload: PasswordResetPayload,
) {
  return client.outboxMessage.create({
    data: {
      kind: "password-reset",
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export async function enqueueEventInvite(
  client: OutboxClient,
  payload: EventInvitePayload,
) {
  return client.outboxMessage.create({
    data: {
      kind: "event-invite",
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export async function enqueueEmailVerification(
  client: OutboxClient,
  payload: EmailVerificationPayload,
) {
  return client.outboxMessage.create({
    data: { kind: "email-verification", payload: payload as Prisma.InputJsonValue },
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

function asRsvpStatusPayload(value: Prisma.JsonValue): RsvpStatusPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.to !== "string" ||
    typeof payload.eventTitle !== "string" ||
    typeof payload.approved !== "boolean" ||
    (payload.checkInToken !== undefined && typeof payload.checkInToken !== "string")
  ) return null;
  return payload as RsvpStatusPayload;
}

function asPasswordResetPayload(value: Prisma.JsonValue): PasswordResetPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.to !== "string" ||
    typeof payload.resetUrl !== "string" ||
    typeof payload.expiresAt !== "string" ||
    Number.isNaN(Date.parse(payload.expiresAt))
  ) return null;
  return payload as PasswordResetPayload;
}

function asEventInvitePayload(value: Prisma.JsonValue): EventInvitePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.to !== "string" ||
    typeof payload.eventTitle !== "string" ||
    typeof payload.organisationName !== "string" ||
    typeof payload.orgSlug !== "string" ||
    typeof payload.eventSlug !== "string"
  ) return null;
  return payload as EventInvitePayload;
}

function asEmailVerificationPayload(value: Prisma.JsonValue): EmailVerificationPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.to !== "string" || typeof payload.verificationUrl !== "string" || typeof payload.expiresAt !== "string" || Number.isNaN(Date.parse(payload.expiresAt))) return null;
  return payload as EmailVerificationPayload;
}
function asCollaboratorInvitePayload(value: Prisma.JsonValue): CollaboratorInvitePayload | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const p = value as Record<string, unknown>; return typeof p.to === "string" && typeof p.eventTitle === "string" && typeof p.inviteUrl === "string" ? p as CollaboratorInvitePayload : null; }

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
      let removeAfterDelivery = false;
      if (message.kind === "rsvp-confirmation") {
        const payload = asRsvpConfirmationPayload(message.payload);
        if (!payload) throw new Error("Invalid RSVP confirmation payload");
        await sendRSVPConfirmation(payload);
      } else if (message.kind === "rsvp-status") {
        const payload = asRsvpStatusPayload(message.payload);
        if (!payload) throw new Error("Invalid RSVP status payload");
        if (payload.approved) {
          await sendRSVPConfirmation({
            to: payload.to,
            eventTitle: payload.eventTitle,
            status: RsvpStatus.CONFIRMED,
            checkInToken: payload.checkInToken,
          });
        } else {
          await sendApprovalNotification(payload);
        }
      } else if (message.kind === "password-reset") {
        const payload = asPasswordResetPayload(message.payload);
        if (!payload) throw new Error("Invalid password reset payload");
        if (new Date(payload.expiresAt) <= new Date()) {
          await prisma.outboxMessage.delete({ where: { id: message.id } });
          failed += 1;
          continue;
        }
        await sendPasswordResetEmail(payload);
        // Reset URLs are bearer secrets. Remove them immediately after sending
        // rather than retaining them with ordinary delivery history.
        removeAfterDelivery = true;
      } else if (message.kind === "email-verification") {
        const payload = asEmailVerificationPayload(message.payload);
        if (!payload) throw new Error("Invalid email verification payload");
        if (new Date(payload.expiresAt) <= new Date()) {
          await prisma.outboxMessage.delete({ where: { id: message.id } });
          failed += 1;
          continue;
        }
        await sendEmailVerificationEmail(payload);
        // Verification URLs are bearer secrets; do not retain them after delivery.
        removeAfterDelivery = true;
      } else if (message.kind === "event-invite") {
        const payload = asEventInvitePayload(message.payload);
        if (!payload) throw new Error("Invalid event invite payload");
        await sendEventInvitation(payload);
      } else if (message.kind === "collaborator-invite") {
        const payload = asCollaboratorInvitePayload(message.payload);
        if (!payload) throw new Error("Invalid collaborator invite payload");
        await sendCollaboratorInvitation(payload);
        removeAfterDelivery = true;
      } else {
        throw new Error("Unsupported outbox message kind");
      }
      if (removeAfterDelivery) {
        await prisma.outboxMessage.delete({ where: { id: message.id } });
      } else {
        await prisma.outboxMessage.update({
          where: { id: message.id },
          data: { status: OutboxStatus.SENT, sentAt: new Date(), lastError: null },
        });
      }
      sent += 1;
    } catch (error) {
      const attempts = message.attempts + 1;
      const retryAt = new Date(Date.now() + Math.min(60 * 60_000, 2 ** attempts * 60_000));
      if ((message.kind === "password-reset" || message.kind === "email-verification") && attempts >= 8) {
        await prisma.outboxMessage.delete({ where: { id: message.id } });
      } else {
        await prisma.outboxMessage.update({
          where: { id: message.id },
          data: {
            status: attempts >= 8 ? OutboxStatus.FAILED : OutboxStatus.PENDING,
            availableAt: retryAt,
            lastError: redactSensitiveText(error instanceof Error ? error.message : "Delivery failed").slice(0, 500),
          },
        });
      }
      failed += 1;
    }
  }
  return { sent, failed };
}
