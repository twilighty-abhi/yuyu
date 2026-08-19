"use server";

import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";
import { isActionRateLimited } from "@/lib/actionRateLimit";

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

  // Delete any existing reset tokens for this email
  await prisma.verificationToken.deleteMany({
    where: { identifier: `reset:${email}` },
  });

  // Store the token
  await prisma.verificationToken.create({
    data: {
      identifier: `reset:${email}`,
      token: tokenHash,
      expires,
    },
  });

  // Send the reset email
  const baseUrl = (
    process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
  ).replace(/\/$/, "");
  const resetUrl = `${baseUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

  try {
    const { sendPasswordResetEmail } = await import("@/lib/email/passwordReset");
    await sendPasswordResetEmail({ to: email, resetUrl });
  } catch (err) {
    console.error("[PASSWORD RESET] Failed to send email:", err);
    // Still return success — don't expose errors to the client
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

  const record = await prisma.verificationToken.findFirst({
    where: {
      identifier: `reset:${email}`,
      token: tokenHash,
    },
  });

  if (!record) {
    return { ok: false, error: "Invalid or expired reset link." };
  }

  if (record.expires < new Date()) {
    // Clean up expired token
    await prisma.verificationToken.deleteMany({
      where: { identifier: `reset:${email}`, token: tokenHash },
    });
    return {
      ok: false,
      error: "This reset link has expired. Please request a new one.",
    };
  }

  // Update the password
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { email },
    data: { passwordHash, sessionVersion: { increment: 1 } },
  });

  // Delete the used token
  await prisma.verificationToken.deleteMany({
    where: { identifier: `reset:${email}` },
  });

  return { ok: true, data: { reset: true } };
}
