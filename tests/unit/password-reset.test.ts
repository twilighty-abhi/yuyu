import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const sendResetMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: rateLimitMock }));
vi.mock("@/lib/email/passwordReset", () => ({ sendPasswordResetEmail: sendResetMock }));

import { requestPasswordReset } from "@/app/actions/password-reset";

const tx = {
  verificationToken: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
  rateLimitMock.mockResolvedValue(false);
  prismaMock.user.findUnique.mockResolvedValue({ id: "user_1", passwordHash: "hash" });
  prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<void>) => callback(tx));
  tx.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
  tx.verificationToken.create.mockResolvedValue({});
  sendResetMock.mockResolvedValue(undefined);
});

describe("requestPasswordReset", () => {
  it("sends a reset link immediately after creating its one-time token", async () => {
    await expect(requestPasswordReset({ email: "person@example.com" })).resolves.toEqual({
      ok: true,
      data: { sent: true },
    });

    expect(tx.verificationToken.create).toHaveBeenCalledTimes(1);
    expect(sendResetMock).toHaveBeenCalledWith({
      to: "person@example.com",
      resetUrl: expect.stringMatching(/^http:\/\/localhost:3000\/reset-password\?token=[a-f0-9]{64}&email=person%40example\.com$/),
    });
    expect(sendResetMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.verificationToken.create.mock.invocationCallOrder[0],
    );
  });
});
