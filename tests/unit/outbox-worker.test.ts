import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deliver: vi.fn(),
  purge: vi.fn(),
  started: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));
vi.mock("@/lib/outbox", () => ({ deliverOutboxBatch: mocks.deliver }));
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
});
