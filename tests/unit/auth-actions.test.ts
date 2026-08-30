import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hash: vi.fn(),
  rateLimit: vi.fn(),
  registrationEnabled: vi.fn(),
  userFind: vi.fn(),
  userCreate: vi.fn(),
  transaction: vi.fn(),
  issueVerification: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash } }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/instanceSettings", () => ({ isNewUserRegistrationEnabled: mocks.registrationEnabled }));
vi.mock("@/lib/emailVerification", () => ({
  issueEmailVerification: mocks.issueVerification,
  verifyEmail: vi.fn(),
}));

const tx = { user: { create: mocks.userCreate } };
vi.mock("@/lib/db", () => ({ prisma: {
  user: { findUnique: mocks.userFind },
  $transaction: mocks.transaction,
} }));

import { resendEmailVerification, signUpWithPassword } from "@/app/actions/auth";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registrationEnabled.mockResolvedValue(true);
  mocks.rateLimit.mockResolvedValue(false);
  mocks.hash.mockResolvedValue("password-hash");
  mocks.userFind.mockResolvedValue(null);
  mocks.userCreate.mockResolvedValue({ id: "user_1", email: "person@example.test" });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("password account creation", () => {
  it("does not attach a password to an existing OAuth identity", async () => {
    mocks.userFind.mockResolvedValue({ id: "oauth_user", passwordHash: null });
    const result = await signUpWithPassword({ name: "Attacker", email: "person@example.test", password: "new-password" });
    expect(result).toEqual({ ok: false, error: "We couldn't create an account with those credentials. Try signing in or resetting your password." });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("creates the user and verification outbox record in one transaction", async () => {
    await expect(signUpWithPassword({ name: "Person", email: "PERSON@example.test", password: "new-password" }))
      .resolves.toEqual({ ok: true, data: { email: "person@example.test" } });
    expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: "Person", email: "person@example.test", passwordHash: "password-hash" },
    }));
    expect(mocks.issueVerification).toHaveBeenCalledWith({ id: "user_1", email: "person@example.test" }, tx);
  });

  it("does not touch persistence when instance registration is disabled", async () => {
    mocks.registrationEnabled.mockResolvedValue(false);
    await expect(signUpWithPassword({ name: "Person", email: "person@example.test", password: "new-password" }))
      .resolves.toEqual({ ok: false, error: "New account creation is currently unavailable." });
    expect(mocks.userFind).not.toHaveBeenCalled();
  });

  it("keeps resend behavior generic for an unknown account", async () => {
    await expect(resendEmailVerification({ email: "missing@example.test" }))
      .resolves.toEqual({ ok: true, data: { sent: true } });
    expect(mocks.issueVerification).not.toHaveBeenCalled();
  });
});
