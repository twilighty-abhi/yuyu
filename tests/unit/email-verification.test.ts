import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));
const enqueueMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/outbox", () => ({ enqueueEmailVerification: enqueueMock }));

import { issueEmailVerification, verifyEmail } from "@/lib/emailVerification";

const tx = {
  verificationToken: {
    deleteMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  user: { update: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:3000";
  tx.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
  tx.verificationToken.create.mockResolvedValue({});
  tx.user.update.mockResolvedValue({});
  enqueueMock.mockResolvedValue({});
});

describe("email verification", () => {
  it("stores only a hash and queues a one-time verification link", async () => {
    await issueEmailVerification({ id: "user_1", email: "person@example.com" }, tx as never);

    expect(tx.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "email-verification:user_1" },
    });
    expect(tx.verificationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        identifier: "email-verification:user_1",
        token: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(enqueueMock).toHaveBeenCalledWith(tx, expect.objectContaining({
      to: "person@example.com",
      verificationUrl: expect.stringMatching(/^http:\/\/localhost:3000\/verify-email\?token=[a-f0-9]{64}$/),
    }));
  });

  it("atomically consumes a valid token and marks the user verified", async () => {
    const rawToken = "a".repeat(64);
    tx.verificationToken.findUnique.mockResolvedValue({
      identifier: "email-verification:user_1",
      expires: new Date(Date.now() + 60_000),
    });
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<boolean>) => callback(tx));

    await expect(verifyEmail(rawToken)).resolves.toBe(true);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { emailVerified: expect.any(Date) },
    });
    expect(tx.verificationToken.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("rejects expired links without changing the user", async () => {
    tx.verificationToken.findUnique.mockResolvedValue({
      identifier: "email-verification:user_1",
      expires: new Date(Date.now() - 1),
    });
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<boolean>) => callback(tx));

    await expect(verifyEmail("a".repeat(64))).resolves.toBe(false);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
