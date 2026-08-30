import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSuperAdminMfa: vi.fn(),
  rateLimit: vi.fn(),
  findSetting: vi.fn(),
  upsertSetting: vi.fn(),
  encrypt: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
  deliver: vi.fn(),
  tokenDelete: vi.fn(),
  outboxUpdate: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ requireSuperAdminMfa: mocks.requireSuperAdminMfa }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/db", () => ({ prisma: {
  instanceSetting: { findUnique: mocks.findSetting, upsert: mocks.upsertSetting },
  verificationToken: { deleteMany: mocks.tokenDelete },
  outboxMessage: { updateMany: mocks.outboxUpdate },
} }));
vi.mock("@/lib/instanceConfigSecrets", () => ({ encryptInstanceConfigSecret: mocks.encrypt }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/outbox", () => ({ deliverOutboxBatch: mocks.deliver }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { saveInstanceServiceSettings } from "@/app/actions/instance-settings";
import {
  deliverInstanceOutbox,
  purgeExpiredVerificationTokens,
  recordBackupRestoreVerification,
  retryFailedOutboxMessages,
} from "@/app/actions/instance";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSuperAdminMfa.mockResolvedValue({ user: { id: "admin_1" } });
  mocks.rateLimit.mockResolvedValue(false);
  mocks.findSetting.mockResolvedValue(null);
  mocks.encrypt.mockImplementation((value: string) => `encrypted:${value}`);
  mocks.deliver.mockResolvedValue({ sent: 1, failed: 0 });
  mocks.tokenDelete.mockResolvedValue({ count: 2 });
  mocks.outboxUpdate.mockResolvedValue({ count: 3 });
});

describe("super-admin instance mutations", () => {
  it("requires the action-level fresh MFA gate for every maintenance mutation", async () => {
    await deliverInstanceOutbox();
    await purgeExpiredVerificationTokens();
    await retryFailedOutboxMessages();
    await recordBackupRestoreVerification();

    expect(mocks.requireSuperAdminMfa).toHaveBeenCalledTimes(4);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(4);
  });

  it("never passes plaintext form secrets or unknown secret fields to Prisma", async () => {
    await expect(saveInstanceServiceSettings({
      emailFrom: "sender@example.test",
      smtpHost: "smtp.example.test",
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: "sender@example.test",
      smtpPassword: "smtp-plaintext",
      smtpAllowUnauthenticated: false,
      googleClientId: "google-client",
      googleClientSecret: "google-plaintext",
    })).resolves.toEqual({ ok: true });

    const call = mocks.upsertSetting.mock.calls[0]?.[0];
    expect(call.create).not.toHaveProperty("smtpPassword");
    expect(call.create).not.toHaveProperty("googleClientSecret");
    expect(call.update).not.toHaveProperty("smtpPassword");
    expect(call.update).not.toHaveProperty("googleClientSecret");
    expect(call.create.smtpPasswordEncrypted).toBe("encrypted:smtp-plaintext");
    expect(call.create.googleClientSecretEncrypted).toBe("encrypted:google-plaintext");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      metadata: { smtpConfigured: true, googleSsoConfigured: true, backupConfigured: false },
    }));
  });

  it("rate limits before invoking an operational mutation", async () => {
    mocks.rateLimit.mockResolvedValue(true);
    await expect(deliverInstanceOutbox()).resolves.toEqual({
      ok: false,
      error: "Too many requests. Try again shortly.",
    });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
