"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { hasRecentAuthentication } from "@/lib/reauth";
import { createMfaEnrollment, decryptMfaSecret, encryptMfaSecret, generateRecoveryCodes, hashRecoveryCode, verifyMfaCode } from "@/lib/mfa";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import type { ActionResult } from "./org";

const codeSchema = z.object({ code: z.string().trim().min(6).max(32) });

export async function beginMfaEnrollment(): Promise<ActionResult<{ secret: string; uri: string }>> {
  const session = await requireAuth();
  if (!(await hasRecentAuthentication())) return { ok: false, error: "Sign in again before enabling MFA." };
  if (!session.user.email) return { ok: false, error: "An email address is required to enable MFA." };
  const enrollment = createMfaEnrollment(session.user.email);
  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.deleteMany({ where: { identifier: `mfa:${session.user.id}` } });
    await tx.verificationToken.create({
      data: {
        identifier: `mfa:${session.user.id}`,
        token: encryptMfaSecret(enrollment.secret),
        expires: new Date(Date.now() + 10 * 60_000),
      },
    });
  });
  return { ok: true, data: enrollment };
}

export async function confirmMfaEnrollment(input: unknown): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const session = await requireAuth();
  if (await isActionRateLimited("auth", session.user.id)) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success || !session.user.email) return { ok: false, error: "Enter a valid authenticator code." };
  const pending = await prisma.verificationToken.findFirst({
    where: { identifier: `mfa:${session.user.id}`, expires: { gt: new Date() } },
    orderBy: { expires: "desc" },
  });
  if (!pending) return { ok: false, error: "MFA setup expired. Start again." };
  const secret = decryptMfaSecret(pending.token);
  if (!verifyMfaCode(secret, session.user.email, parsed.data.code)) return { ok: false, error: "Invalid authenticator code." };
  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: session.user.id },
      data: {
        mfaSecretEncrypted: encryptMfaSecret(secret),
        mfaEnabledAt: new Date(),
        recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
        sessionVersion: { increment: 1 },
      },
    });
    await tx.verificationToken.deleteMany({ where: { identifier: `mfa:${session.user.id}` } });
    await tx.auditEvent.create({ data: { action: "MFA_ENABLED", actorUserId: session.user.id, targetType: "User", targetId: session.user.id } });
  });
  return { ok: true, data: { recoveryCodes } };
}

export async function disableMfa(input: unknown): Promise<ActionResult> {
  const session = await requireAuth();
  if (await isActionRateLimited("auth", session.user.id)) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success || !session.user.email) return { ok: false, error: "Enter an authenticator or recovery code." };
  if (!(await hasRecentAuthentication())) return { ok: false, error: "Sign in again before disabling MFA." };
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { mfaSecretEncrypted: true, recoveryCodeHashes: true } });
  if (!user?.mfaSecretEncrypted) return { ok: false, error: "MFA is not enabled." };
  const validTotp = verifyMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), session.user.email, parsed.data.code);
  const validRecovery = user.recoveryCodeHashes.includes(hashRecoveryCode(parsed.data.code));
  if (!validTotp && !validRecovery) return { ok: false, error: "Invalid authenticator or recovery code." };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: session.user.id }, data: { mfaSecretEncrypted: null, mfaEnabledAt: null, recoveryCodeHashes: [], sessionVersion: { increment: 1 } } });
    await tx.auditEvent.create({ data: { action: "MFA_DISABLED", actorUserId: session.user.id, targetType: "User", targetId: session.user.id } });
  });
  return { ok: true };
}

export async function revokeAllSessions(): Promise<ActionResult> {
  const session = await requireAuth();
  if (!(await hasRecentAuthentication())) return { ok: false, error: "Sign in again before revoking sessions." };
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: session.user.id }, data: { sessionVersion: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId: session.user.id } });
    await tx.auditEvent.create({ data: { action: "SESSIONS_REVOKED", actorUserId: session.user.id, targetType: "User", targetId: session.user.id } });
  });
  return { ok: true };
}
