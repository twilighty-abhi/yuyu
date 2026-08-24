"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { sendPasswordResetEmail } from "@/lib/email/passwordReset";

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── Request password reset ──────────────────────────────────────────

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

/**
 * Create a password reset token and (optionally) email a link.
 * Returns success even if the email isn't registered (prevents enumeration).
 */
export async function requestPasswordReset(
  input: unknown,
): Promise<ActionResult<{ sent: true }>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid email address.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { email } = parsed.data;
  if (await isActionRateLimited("passwordReset", email)) {
    // Keep this indistinguishable from the usual non-enumerating response.
    return { ok: true, data: { sent: true } };
  }
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  // Always return success to prevent email enumeration
  if (!user || !user.passwordHash) {
    return { ok: true, data: { sent: true } };
  }

  // Generate a secure random token
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expires = new Date(Date.now() + TOKEN_EXPIRY_MS);

  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const resetUrl = `${baseUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

  // A reset link is time-sensitive. Store its one-time hash first, then send
  // synchronously so the recipient does not wait for the periodic outbox job.
  await prisma.$transaction(async (tx) => {
    await tx.verificationToken.deleteMany({
      where: { identifier: `reset:${email}` },
    });
    await tx.verificationToken.create({
      data: { identifier: `reset:${email}`, token: tokenHash, expires },
    });
  });

  try {
    await sendPasswordResetEmail({ to: email, resetUrl });
  } catch (error) {
    // Preserve the non-enumerating response. Operators receive the server-side
    // error while the caller cannot infer whether an account exists.
    console.error("[password reset] immediate email delivery failed", error);
  }

  return { ok: true, data: { sent: true } };
}

// ── Confirm password reset ──────────────────────────────────────────

const resetSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  token: z.string().min(1, "Reset token is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
});

/**
 * Verify the reset token and set a new password.
 */
export async function confirmPasswordReset(
  input: unknown,
): Promise<ActionResult<{ reset: true }>> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { email, token, password } = parsed.data;
  if (await isActionRateLimited("passwordReset", email)) {
    return { ok: false, error: "Invalid or expired reset link." };
  }
  const tokenHash = hashToken(token);

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await prisma.$transaction(async (tx) => {
    // Consume the exact token before changing credentials. This makes a reset
    // link single-use even if two requests arrive at the same time.
    const consumed = await tx.verificationToken.deleteMany({
      where: {
        identifier: `reset:${email}`,
        token: tokenHash,
        expires: { gt: new Date() },
      },
    });
    if (consumed.count !== 1) return false;
    await tx.user.update({
      where: { email },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    await tx.verificationToken.deleteMany({ where: { identifier: `reset:${email}` } });
    return true;
  });
  if (!result) return { ok: false, error: "Invalid or expired reset link." };

  return { ok: true, data: { reset: true } };
}
