import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  recent: vi.fn(),
  rateLimit: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  sessionDelete: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/reauth", () => ({ hasRecentAuthentication: mocks.recent }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: mocks.rateLimit }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare, hash: mocks.hash } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const tx = {
  user: { update: mocks.userUpdate },
  session: { deleteMany: mocks.sessionDelete },
  auditEvent: { create: mocks.auditCreate },
};
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: mocks.userFind, update: mocks.userUpdate },
    $transaction: mocks.transaction,
  },
}));

import { updateAccountPassword } from "@/app/actions/account";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue({ user: { id: "user_1" } });
  mocks.recent.mockResolvedValue(true);
  mocks.rateLimit.mockResolvedValue(false);
  mocks.compare.mockResolvedValue(true);
  mocks.hash.mockResolvedValue("new-hash");
  mocks.userFind.mockResolvedValue({ email: "person@example.com", passwordHash: "old-hash" });
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
});

describe("account password actions", () => {
  it("changes a password after verifying the current password and revokes sessions", async () => {
    await expect(updateAccountPassword({ currentPassword: "current-password", newPassword: "new-password", confirmPassword: "new-password" })).resolves.toEqual({ ok: true, data: { passwordSet: true } });
    expect(mocks.compare).toHaveBeenCalledWith("current-password", "old-hash");
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ passwordHash: "new-hash", sessionVersion: { increment: 1 } }) }));
    expect(mocks.sessionDelete).toHaveBeenCalledWith({ where: { userId: "user_1" } });
  });

  it("lets a recently authenticated Google-only user add a password", async () => {
    mocks.userFind.mockResolvedValue({ email: "person@example.com", passwordHash: null });
    await expect(updateAccountPassword({ newPassword: "new-password", confirmPassword: "new-password" })).resolves.toEqual({ ok: true, data: { passwordSet: true } });
    expect(mocks.compare).not.toHaveBeenCalled();
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "ACCOUNT_PASSWORD_ADDED" }) }));
  });

  it("requires a fresh Google sign-in before adding a password", async () => {
    mocks.userFind.mockResolvedValue({ email: "person@example.com", passwordHash: null });
    mocks.recent.mockResolvedValue(false);
    await expect(updateAccountPassword({ newPassword: "new-password", confirmPassword: "new-password" })).resolves.toEqual({ ok: false, error: "Sign in with Google again before adding a password." });
  });
});
