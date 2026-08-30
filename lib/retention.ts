import "server-only";

import { OutboxStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Remove expired operational records without deleting business/audit data. */
export async function purgeExpiredOperationalData(now = new Date()) {
  const outboxRetentionDays = Math.min(
    Math.max(Number(process.env.OUTBOX_RETENTION_DAYS || 30), 1),
    365,
  );
  const sentBefore = new Date(now.getTime() - outboxRetentionDays * DAY_MS);
  const [tokens, sessions, organisationInvites, collaboratorInvites, undoSnapshots, sentMessages, failedMessages] = await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { expires: { lt: now } } }),
    prisma.session.deleteMany({ where: { expires: { lt: now } } }),
    prisma.organisationInvite.deleteMany({ where: { usedAt: null, expiresAt: { lt: now } } }),
    prisma.eventCollaboratorInvite.deleteMany({ where: { usedAt: null, expiresAt: { lt: now } } }),
    prisma.rsvpDeletionUndo.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.outboxMessage.deleteMany({
      where: { status: OutboxStatus.SENT, sentAt: { lt: sentBefore } },
    }),
    prisma.outboxMessage.deleteMany({
      where: { status: OutboxStatus.FAILED, createdAt: { lt: sentBefore } },
    }),
  ]);
  return {
    verificationTokens: tokens.count,
    expiredSessions: sessions.count,
    unusedOrganisationInvites: organisationInvites.count,
    unusedCollaboratorInvites: collaboratorInvites.count,
    undoSnapshots: undoSnapshots.count,
    sentOutboxMessages: sentMessages.count,
    failedOutboxMessages: failedMessages.count,
  };
}
