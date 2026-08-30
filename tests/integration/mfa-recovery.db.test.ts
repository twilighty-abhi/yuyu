import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { consumeRecoveryCode, hashRecoveryCode } from "@/lib/mfa";

const suffix = randomUUID().replace(/-/g, "");
const userId = `mfa_recovery_${suffix}`;

describe.sequential("MFA recovery-code concurrency", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET = "integration-auth-secret-with-at-least-32-characters";
    await prisma.user.create({
      data: {
        id: userId,
        name: "MFA concurrency test",
        email: `mfa-${suffix}@example.test`,
        recoveryCodeHashes: [],
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("allows only one concurrent use of the same recovery code", async () => {
    const code = "AAAA-BBBB-CCCC";
    await prisma.user.update({
      where: { id: userId },
      data: { recoveryCodeHashes: [hashRecoveryCode(code)] },
    });

    const results = await Promise.all([
      consumeRecoveryCode(userId, code),
      consumeRecoveryCode(userId, code),
    ]);
    expect(results.sort()).toEqual([false, true]);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { recoveryCodeHashes: true } }))
      .resolves.toEqual({ recoveryCodeHashes: [] });
  });

  it("does not reintroduce codes when different codes are consumed concurrently", async () => {
    const first = "1111-2222-3333";
    const second = "4444-5555-6666";
    await prisma.user.update({
      where: { id: userId },
      data: { recoveryCodeHashes: [hashRecoveryCode(first), hashRecoveryCode(second)] },
    });

    await expect(Promise.all([
      consumeRecoveryCode(userId, first),
      consumeRecoveryCode(userId, second),
    ])).resolves.toEqual([true, true]);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { recoveryCodeHashes: true } }))
      .resolves.toEqual({ recoveryCodeHashes: [] });
  });
});
