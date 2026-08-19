"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

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
  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
    },
  });

  return { ok: true, data: { email } };
}
