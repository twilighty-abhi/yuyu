import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  rateLimit: vi.fn(),
  userFind: vi.fn(),
  auditCreate: vi.fn(),
  decrypt: vi.fn(),
  verify: vi.fn(),
  createProof: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ requireSuperAdmin: mocks.requireSuperAdmin }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findUnique: mocks.userFind },
  auditEvent: { create: mocks.auditCreate },
} }));
vi.mock("@/lib/mfa", () => ({
  decryptMfaSecret: mocks.decrypt,
  verifyMfaCode: mocks.verify,
}));
vi.mock("@/lib/superAdminMfa", () => ({
  createSuperAdminMfaProof: mocks.createProof,
  SUPER_ADMIN_MFA_COOKIE: "mfa-proof",
  SUPER_ADMIN_MFA_MAX_AGE_SECONDS: 600,
}));
vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ set: mocks.cookieSet }) }));

import { verifySuperAdminMfa } from "@/app/actions/super-admin-mfa";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSuperAdmin.mockResolvedValue({ user: { id: "admin_1", email: "admin@example.test" } });
  mocks.rateLimit.mockResolvedValue(false);
  mocks.userFind.mockResolvedValue({
    email: "admin@example.test",
    mfaSecretEncrypted: "encrypted",
    mfaEnabledAt: new Date(),
    sessionVersion: 4,
  });
  mocks.decrypt.mockReturnValue("SECRET");
  mocks.verify.mockReturnValue(true);
  mocks.createProof.mockReturnValue("signed-proof");
});

describe("super-admin MFA action", () => {
  it("applies the strict authentication limit before verifying a code", async () => {
    mocks.rateLimit.mockResolvedValue(true);
    await expect(verifySuperAdminMfa({ code: "123456" })).resolves.toEqual({
      ok: false,
      error: "Too many attempts. Please try again later.",
    });
    expect(mocks.rateLimit).toHaveBeenCalledWith("auth", "admin_1");
    expect(mocks.userFind).not.toHaveBeenCalled();
  });

  it("sets a short-lived HttpOnly proof only after successful TOTP verification", async () => {
    await expect(verifySuperAdminMfa({ code: "123456" })).resolves.toEqual({ ok: true });
    expect(mocks.cookieSet).toHaveBeenCalledWith("mfa-proof", "signed-proof", expect.objectContaining({
      httpOnly: true,
      sameSite: "strict",
      maxAge: 600,
      path: "/super-admin",
    }));
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
  });
});
