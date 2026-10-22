import "server-only";

import { deliverOutboxBatch } from "@/lib/outbox";
import {
  recordOutboxSchedulerFailure,
  recordOutboxSchedulerStarted,
  recordOutboxSchedulerSuccess,
} from "@/lib/operationalHeartbeat";
import { purgeExpiredOperationalData } from "@/lib/retention";
import { logOpsError } from "@/lib/opsAlerts";
import { deliverWebhookBatch } from "@/lib/webhooks/delivery";

const OUTBOX_WORKER_INTERVAL_MS = 60_000;

type OutboxWorkerState = {
  started?: boolean;
  running?: boolean;
  timer?: ReturnType<typeof setInterval>;
};

function workerState() {
  return globalThis as typeof globalThis & { __yuyuOutboxWorker?: OutboxWorkerState };
}

/** Runs one complete delivery/retention pass and records its operational state. */
export async function runOutboxScheduler() {
  // Heartbeat persistence is observability, not part of the delivery commit.
  // A heartbeat-table issue must not stop otherwise healthy queue processing.
  await recordOutboxSchedulerStarted().catch(() => undefined);
  try {
    const result = await deliverOutboxBatch();
    // Organisation webhooks share this cadence but never fail the email pass.
    const webhooks = await deliverWebhookBatch().catch((error: unknown) => {
      logOpsError("[webhooks] delivery pass failed", { level: "error", source: "webhooks", title: "Webhook delivery pass failed", error });
      return { delivered: 0, failed: 0 };
    });
    const purged = await purgeExpiredOperationalData();
    await recordOutboxSchedulerSuccess(result).catch(() => undefined);
    return { ...result, webhooks, purged };
  } catch (error) {
    await recordOutboxSchedulerFailure(error).catch(() => undefined);
    throw error;
  }
}

/**
 * Start one polling worker per Node.js process. Queue row claims make this safe
 * across replicas; the singleton guard avoids duplicate timers during dev HMR.
 */
export function startOutboxWorker() {
  const runtime = workerState();
  if (runtime.__yuyuOutboxWorker?.started) return;

  const state: OutboxWorkerState = { started: true, running: false };
  runtime.__yuyuOutboxWorker = state;

  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await runOutboxScheduler();
    } catch (error) {
      // Failure metadata is persisted separately without exception text.
      logOpsError("[outbox worker] scheduler run failed", { level: "error", source: "outbox worker", title: "Scheduler run failed", error });
    } finally {
      state.running = false;
    }
  };

  void tick();
  state.timer = setInterval(() => {
    void tick();
  }, OUTBOX_WORKER_INTERVAL_MS);
  state.timer.unref?.();
}
