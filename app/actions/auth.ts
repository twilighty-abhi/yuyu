"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
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

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  if (existing) {
    if (existing.passwordHash) {
      return {
        ok: false,
        error: "An account with that email already exists. Sign in instead.",
        fieldErrors: { email: ["Email is already registered"] },
      };
    }
    // Account exists via OAuth but no password yet — attach one.
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name: name,
      },
    });
    return { ok: true, data: { email } };
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
