import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(), recent: vi.fn(), createEnrollment: vi.fn(), decrypt: vi.fn(), encrypt: vi.fn(), generateCodes: vi.fn(), hashCode: vi.fn(), verify: vi.fn(),
  rateLimit: vi.fn(),
  pending: vi.fn(), userFind: vi.fn(), userUpdate: vi.fn(), sessionDelete: vi.fn(), tokenDelete: vi.fn(), tokenCreate: vi.fn(), auditCreate: vi.fn(), transaction: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/reauth", () => ({ hasRecentAuthentication: mocks.recent }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/mfa", () => ({
  createMfaEnrollment: mocks.createEnrollment, decryptMfaSecret: mocks.decrypt, encryptMfaSecret: mocks.encrypt,
  generateRecoveryCodes: mocks.generateCodes, hashRecoveryCode: mocks.hashCode, verifyMfaCode: mocks.verify,
}));

const tx = {
  user: { update: mocks.userUpdate }, session: { deleteMany: mocks.sessionDelete },
  verificationToken: { deleteMany: mocks.tokenDelete, create: mocks.tokenCreate }, auditEvent: { create: mocks.auditCreate },
};
vi.mock("@/lib/db", () => ({ prisma: {
  verificationToken: { findFirst: mocks.pending }, user: { findUnique: mocks.userFind },
  $transaction: mocks.transaction,
} }));

import { beginMfaEnrollment, confirmMfaEnrollment, disableMfa, revokeAllSessions } from "@/app/actions/security";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ user: { id: "user_1", email: "person@example.com" } });
  mocks.recent.mockResolvedValue(true);
  mocks.rateLimit.mockResolvedValue(false);
  mocks.createEnrollment.mockReturnValue({ secret: "SECRET", uri: "otpauth://test" });
  mocks.encrypt.mockReturnValue("encrypted");
  mocks.decrypt.mockReturnValue("SECRET");
  mocks.verify.mockReturnValue(true);
  mocks.generateCodes.mockReturnValue(["ABCD-EF12-3456"]);
  mocks.hashCode.mockImplementation((value: string) => `hash:${value}`);
  mocks.pending.mockResolvedValue({ token: "pending" });
  mocks.userFind.mockResolvedValue({ mfaSecretEncrypted: "encrypted", recoveryCodeHashes: [] });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("account security actions", () => {
  it("creates and confirms an MFA enrollment", async () => {
    await expect(beginMfaEnrollment()).resolves.toEqual({ ok: true, data: { secret: "SECRET", uri: "otpauth://test" } });
    await expect(confirmMfaEnrollment({ code: "123456" })).resolves.toEqual({ ok: true, data: { recoveryCodes: ["ABCD-EF12-3456"] } });
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mfaEnabledAt: expect.any(Date), sessionVersion: { increment: 1 } }) }));
    expect(mocks.auditCreate).toHaveBeenCalled();
  });

  it("rejects an invalid setup code", async () => {
    mocks.verify.mockReturnValue(false);
    await expect(confirmMfaEnrollment({ code: "000000" })).resolves.toEqual({ ok: false, error: "Invalid authenticator code." });
  });

  it("rate limits MFA verification before reading pending secrets", async () => {
    mocks.rateLimit.mockResolvedValue(true);
    await expect(confirmMfaEnrollment({ code: "123456" })).resolves.toEqual({ ok: false, error: "Too many attempts. Please try again later." });
    expect(mocks.pending).not.toHaveBeenCalled();
  });

  it("disables MFA and revokes every session atomically", async () => {
    await expect(disableMfa({ code: "123456" })).resolves.toEqual({ ok: true });
    await expect(revokeAllSessions()).resolves.toEqual({ ok: true });
    expect(mocks.sessionDelete).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });
});
