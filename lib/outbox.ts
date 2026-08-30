import "server-only";

import { OutboxStatus, Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sendApprovalNotification, sendCollaboratorInvitation, sendEventInvitation, sendRSVPConfirmation } from "@/lib/email";
import { sendPasswordResetEmail } from "@/lib/email/passwordReset";
import { sendEmailVerificationEmail } from "@/lib/email/emailVerification";
import { describeOperationalError } from "@/lib/redactSensitiveText";

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
  expiresAt?: string;
};

type EmailVerificationPayload = {
  to: string;
  verificationUrl: string;
  expiresAt: string;
};
type CollaboratorInvitePayload = { to: string; eventTitle: string; inviteUrl: string; expiresAt?: string };

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

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isEmail(value: unknown): value is string {
  return isBoundedString(value, 320) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isIsoDate(value: unknown): value is string {
  return isBoundedString(value, 64) && !Number.isNaN(Date.parse(value));
}

function isSafeMessageUrl(value: unknown): value is string {
  if (!isBoundedString(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.protocol === "http:");
  } catch {
    return false;
  }
}

function isExpired(expiresAt: string | undefined, now = new Date()) {
  return expiresAt !== undefined && new Date(expiresAt) <= now;
}

function containsCapability(kind: string, payload: Prisma.JsonValue) {
  if (["rsvp-confirmation", "password-reset", "email-verification", "collaborator-invite"].includes(kind)) return true;
  return kind === "rsvp-status" && Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && typeof (payload as Record<string, unknown>).checkInToken === "string");
}

function messageId(id: string) {
  return `<yuyu-${id}@outbox.invalid>`;
}

class PermanentOutboxError extends Error {
  override name = "PermanentOutboxError";
}

function asRsvpConfirmationPayload(value: Prisma.JsonValue): RsvpConfirmationPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.eventTitle, 200) ||
    !isBoundedString(payload.checkInToken, 128) ||
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
    !isEmail(payload.to) ||
    !isBoundedString(payload.eventTitle, 200) ||
    typeof payload.approved !== "boolean" ||
    (payload.checkInToken !== undefined && !isBoundedString(payload.checkInToken, 128))
  ) return null;
  return payload as RsvpStatusPayload;
}

function asPasswordResetPayload(value: Prisma.JsonValue): PasswordResetPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isSafeMessageUrl(payload.resetUrl) ||
    !isIsoDate(payload.expiresAt)
  ) return null;
  return payload as PasswordResetPayload;
}

function asEventInvitePayload(value: Prisma.JsonValue): EventInvitePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    !isEmail(payload.to) ||
    !isBoundedString(payload.eventTitle, 200) ||
    !isBoundedString(payload.organisationName, 120) ||
    !isBoundedString(payload.orgSlug, 64) ||
    !isBoundedString(payload.eventSlug, 64) ||
    (payload.expiresAt !== undefined && !isIsoDate(payload.expiresAt))
  ) return null;
  return payload as EventInvitePayload;
}

function asEmailVerificationPayload(value: Prisma.JsonValue): EmailVerificationPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!isEmail(payload.to) || !isSafeMessageUrl(payload.verificationUrl) || !isIsoDate(payload.expiresAt)) return null;
  return payload as EmailVerificationPayload;
}
function asCollaboratorInvitePayload(value: Prisma.JsonValue): CollaboratorInvitePayload | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const p = value as Record<string, unknown>; return isEmail(p.to) && isBoundedString(p.eventTitle, 200) && isSafeMessageUrl(p.inviteUrl) && (p.expiresAt === undefined || isIsoDate(p.expiresAt)) ? p as CollaboratorInvitePayload : null; }

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
    const claimTime = new Date();
    const claim = await prisma.outboxMessage.updateMany({
      where: { id: message.id, status: OutboxStatus.PENDING },
      data: { status: OutboxStatus.PROCESSING, lockedAt: claimTime, attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;

    try {
      const removeAfterDelivery = containsCapability(message.kind, message.payload);
      const stableMessageId = messageId(message.id);
      if (message.kind === "rsvp-confirmation") {
        const payload = asRsvpConfirmationPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        await sendRSVPConfirmation({ ...payload, messageId: stableMessageId });
      } else if (message.kind === "rsvp-status") {
        const payload = asRsvpStatusPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (payload.approved) {
          await sendRSVPConfirmation({
            to: payload.to,
            eventTitle: payload.eventTitle,
            status: RsvpStatus.CONFIRMED,
            checkInToken: payload.checkInToken,
            messageId: stableMessageId,
          });
        } else {
          await sendApprovalNotification({ ...payload, messageId: stableMessageId });
        }
      } else if (message.kind === "password-reset") {
        const payload = asPasswordResetPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (isExpired(payload.expiresAt)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          failed += 1;
          continue;
        }
        await sendPasswordResetEmail({ ...payload, messageId: stableMessageId });
      } else if (message.kind === "email-verification") {
        const payload = asEmailVerificationPayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (isExpired(payload.expiresAt)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          failed += 1;
          continue;
        }
        await sendEmailVerificationEmail({ ...payload, messageId: stableMessageId });
      } else if (message.kind === "event-invite") {
        const payload = asEventInvitePayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (isExpired(payload.expiresAt)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          failed += 1;
          continue;
        }
        await sendEventInvitation({ ...payload, messageId: stableMessageId });
      } else if (message.kind === "collaborator-invite") {
        const payload = asCollaboratorInvitePayload(message.payload);
        if (!payload) throw new PermanentOutboxError();
        if (isExpired(payload.expiresAt)) {
          await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
          failed += 1;
          continue;
        }
        await sendCollaboratorInvitation({ ...payload, messageId: stableMessageId });
      } else {
        throw new PermanentOutboxError();
      }
      if (removeAfterDelivery) {
        await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
      } else {
        await prisma.outboxMessage.updateMany({
          where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime },
          data: { status: OutboxStatus.SENT, sentAt: new Date(), lockedAt: null, lastError: null },
        });
      }
      sent += 1;
    } catch (error) {
      const attempts = message.attempts + 1;
      const retryAt = new Date(Date.now() + Math.min(60 * 60_000, 2 ** attempts * 60_000));
      const terminal = error instanceof PermanentOutboxError || attempts >= 8;
      if (containsCapability(message.kind, message.payload) && terminal) {
        await prisma.outboxMessage.deleteMany({ where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime } });
      } else {
        await prisma.outboxMessage.updateMany({
          where: { id: message.id, status: OutboxStatus.PROCESSING, lockedAt: claimTime },
          data: {
            status: terminal ? OutboxStatus.FAILED : OutboxStatus.PENDING,
            availableAt: retryAt,
            lockedAt: null,
            lastError: describeOperationalError(error),
          },
        });
      }
      failed += 1;
    }
  }
  return { sent, failed };
}
