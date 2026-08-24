import "server-only";

import { prisma } from "@/lib/db";
import { redactSensitiveText } from "@/lib/redactSensitiveText";

export const OUTBOX_SCHEDULER_HEARTBEAT_KEY = "outbox-scheduler";

export async function recordOutboxSchedulerStarted() {
  await prisma.operationalHeartbeat.upsert({
    where: { key: OUTBOX_SCHEDULER_HEARTBEAT_KEY },
    create: { key: OUTBOX_SCHEDULER_HEARTBEAT_KEY, lastStartedAt: new Date() },
    update: { lastStartedAt: new Date() },
  });
}

export async function recordOutboxSchedulerSuccess(result: { sent: number; failed: number }) {
  const now = new Date();
  await prisma.operationalHeartbeat.upsert({
    where: { key: OUTBOX_SCHEDULER_HEARTBEAT_KEY },
    create: {
      key: OUTBOX_SCHEDULER_HEARTBEAT_KEY,
      lastStartedAt: now,
      lastSucceededAt: now,
      lastSent: result.sent,
      lastFailed: result.failed,
    },
    update: {
      lastSucceededAt: now,
      lastSent: result.sent,
      lastFailed: result.failed,
      lastError: null,
    },
  });
}

export async function recordOutboxSchedulerFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Scheduler run failed";
  await prisma.operationalHeartbeat.upsert({
    where: { key: OUTBOX_SCHEDULER_HEARTBEAT_KEY },
    create: {
      key: OUTBOX_SCHEDULER_HEARTBEAT_KEY,
      lastStartedAt: new Date(),
      lastError: redactSensitiveText(message).slice(0, 500),
    },
    update: { lastError: redactSensitiveText(message).slice(0, 500) },
  });
}
