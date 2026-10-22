import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(),
  purge: vi.fn(),
  started: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
  webhooks: vi.fn(),
}));
vi.mock("@/lib/outbox", () => ({ deliverOutboxBatch: mocks.deliver }));
vi.mock("@/lib/webhooks/delivery", () => ({ deliverWebhookBatch: mocks.webhooks }));
vi.mock("@/lib/retention", () => ({ purgeExpiredOperationalData: mocks.purge }));
vi.mock("@/lib/operationalHeartbeat", () => ({
  recordOutboxSchedulerStarted: mocks.started,
  recordOutboxSchedulerSuccess: mocks.success,
  recordOutboxSchedulerFailure: mocks.failure,
}));

import { runOutboxScheduler } from "@/lib/outboxWorker";

describe("outbox scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.started.mockResolvedValue(undefined);
    mocks.success.mockResolvedValue(undefined);
    mocks.failure.mockResolvedValue(undefined);
    mocks.deliver.mockResolvedValue({ sent: 2, failed: 0 });
    mocks.purge.mockResolvedValue({ verificationTokens: 1 });
    mocks.webhooks.mockResolvedValue({ delivered: 1, failed: 0 });
  });

  it("does not make heartbeat observability a delivery dependency", async () => {
    mocks.started.mockRejectedValue(new Error("heartbeat unavailable"));
    mocks.success.mockRejectedValue(new Error("heartbeat unavailable"));
    await expect(runOutboxScheduler()).resolves.toMatchObject({ sent: 2, failed: 0 });
    expect(mocks.deliver).toHaveBeenCalled();
    expect(mocks.purge).toHaveBeenCalled();
  });

  it("records a metadata-only scheduler failure and rethrows for the protected route", async () => {
    const error = new Error("delivery failed");
    mocks.deliver.mockRejectedValue(error);
    await expect(runOutboxScheduler()).rejects.toBe(error);
    expect(mocks.failure).toHaveBeenCalledWith(error);
    expect(mocks.purge).not.toHaveBeenCalled();
  });

  it("runs organisation webhook deliveries in the same pass without letting them fail it", async () => {
    await expect(runOutboxScheduler()).resolves.toMatchObject({ sent: 2, webhooks: { delivered: 1, failed: 0 } });
    mocks.webhooks.mockRejectedValue(new Error("webhook table unavailable"));
    await expect(runOutboxScheduler()).resolves.toMatchObject({ sent: 2, webhooks: { delivered: 0, failed: 0 } });
    expect(mocks.purge).toHaveBeenCalledTimes(2);
    expect(mocks.failure).not.toHaveBeenCalled();
  });
});
