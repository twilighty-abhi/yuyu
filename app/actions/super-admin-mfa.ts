"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/permissions";
import { decryptMfaSecret, verifyMfaCode } from "@/lib/mfa";
import { createSuperAdminMfaProof, SUPER_ADMIN_MFA_COOKIE, SUPER_ADMIN_MFA_MAX_AGE_SECONDS } from "@/lib/superAdminMfa";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import type { ActionResult } from "./org";

const schema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter a six-digit authenticator code.") });

export async function verifySuperAdminMfa(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdmin();
  if (await isActionRateLimited("auth", session.user.id)) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a six-digit authenticator code." };

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, mfaSecretEncrypted: true, mfaEnabledAt: true, sessionVersion: true },
  });
  if (!user?.email || !user.mfaEnabledAt || !user.mfaSecretEncrypted) {
    return { ok: false, error: "Authenticator MFA must be enabled before accessing super admin." };
  }

  let valid = false;
  try {
    valid = verifyMfaCode(decryptMfaSecret(user.mfaSecretEncrypted), user.email, parsed.data.code);
  } catch {
    return { ok: false, error: "Could not verify the authenticator code. Start again or contact an administrator." };
  }
  if (!valid) return { ok: false, error: "Invalid authenticator code." };

  const proof = createSuperAdminMfaProof(session.user.id, user.sessionVersion);
  (await cookies()).set(SUPER_ADMIN_MFA_COOKIE, proof, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/super-admin",
    maxAge: SUPER_ADMIN_MFA_MAX_AGE_SECONDS,
    priority: "high",
  });
  await prisma.auditEvent.create({
    data: { action: "SUPER_ADMIN_MFA_VERIFIED", actorUserId: session.user.id, targetType: "User", targetId: session.user.id },
  });
  return { ok: true };
}
