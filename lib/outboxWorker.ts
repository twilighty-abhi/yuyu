import "server-only";

import { deliverOutboxBatch } from "@/lib/outbox";
import {
  recordOutboxSchedulerFailure,
  recordOutboxSchedulerStarted,
  recordOutboxSchedulerSuccess,
} from "@/lib/operationalHeartbeat";
import { purgeExpiredOperationalData } from "@/lib/retention";

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
  await recordOutboxSchedulerStarted();
  try {
    const result = await deliverOutboxBatch();
    const purged = await purgeExpiredOperationalData();
    await recordOutboxSchedulerSuccess(result);
    return { ...result, purged };
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
      // The detailed, redacted failure is persisted in OperationalHeartbeat.
      console.error("[outbox worker] scheduler run failed", error);
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
