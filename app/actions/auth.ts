"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";
import { issueEmailVerification, verifyEmail } from "@/lib/emailVerification";
import { isNewUserRegistrationEnabled } from "@/lib/instanceSettings";

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export async function signUpWithPassword(
  input: unknown,
): Promise<ActionResult<{ email: string }>> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { name, email, password } = parsed.data;

  if (!(await isNewUserRegistrationEnabled())) {
    return { ok: false, error: "New account creation is currently unavailable." };
  }

  if (await isActionRateLimited("signup", email)) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  if (existing) {
    // Never attach a password based solely on a claimed email address. In
    // particular, doing so lets an attacker take over an OAuth-only account.
    return {
      ok: false,
      error: "We couldn't create an account with those credentials. Try signing in or resetting your password.",
    };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, email, passwordHash },
      select: { id: true, email: true },
    });
    // The signup input is a validated non-null email; keep the persisted
    // model nullable for OAuth adapter compatibility.
    await issueEmailVerification({ id: user.id, email }, tx);
  });

  return { ok: true, data: { email } };
}

const verificationTokenSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/, "Invalid verification link."),
});

export async function confirmEmailVerification(input: unknown): Promise<ActionResult<{ verified: true }>> {
  const parsed = verificationTokenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This verification link is invalid or has expired." };
  const verified = await verifyEmail(parsed.data.token);
  if (!verified) return { ok: false, error: "This verification link is invalid or has expired." };
  return { ok: true, data: { verified: true } };
}

const resendVerificationSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
});

/** Always returns the same success response to avoid account enumeration. */
export async function resendEmailVerification(input: unknown): Promise<ActionResult<{ sent: true }>> {
  const parsed = resendVerificationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid email address.", fieldErrors: flattenZodErrors(parsed.error) };
  }
  const { email } = parsed.data;
  if (await isActionRateLimited("signup", email)) return { ok: true, data: { sent: true } };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerified: true, passwordHash: true },
  });
  if (!user || user.emailVerified || !user.passwordHash || !user.email) return { ok: true, data: { sent: true } };

  await prisma.$transaction(async (tx) => {
    await issueEmailVerification({ id: user.id, email: user.email! }, tx);
  });
  return { ok: true, data: { sent: true } };
}
