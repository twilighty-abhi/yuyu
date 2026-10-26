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
/** Messages claimed per batch inside one scheduler pass. */
export const OUTBOX_DRAIN_BATCH = 50;
/**
 * How long one pass keeps draining. Well under the one-minute cadence and a
 * typical proxy timeout for `POST /api/internal/outbox`; overlapping passes
 * (the worker and the external scheduler, or several replicas) are safe
 * because each message is claimed individually.
 */
export const OUTBOX_DRAIN_BUDGET_MS = 40_000;

/**
 * Deliver batches until nothing is due, the time budget is spent, or a whole
 * batch failed (the mail server is likely down: wait for the next pass rather
 * than burn through the retry schedule of the entire queue). A fixed 20 per
 * minute used to leave a 10k-recipient send queued for hours.
 */
export async function drainOutbox(options: { batch?: number; budgetMs?: number; now?: () => number } = {}) {
  const batch = options.batch ?? OUTBOX_DRAIN_BATCH;
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? OUTBOX_DRAIN_BUDGET_MS);
  let sent = 0;
  let failed = 0;
  for (;;) {
    const result = await deliverOutboxBatch(batch);
    sent += result.sent;
    failed += result.failed;
    if (result.sent + result.failed < batch) break;
    if (result.sent === 0) break;
    if (now() >= deadline) break;
  }
  return { sent, failed };
}

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
    const result = await drainOutbox();
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
