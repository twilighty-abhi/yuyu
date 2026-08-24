"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/permissions";
import { hasRecentAuthentication } from "@/lib/reauth";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { recordAuditEvent } from "@/lib/audit";
import { flattenZodErrors } from "./utils";
import type { ActionResult } from "./org";

const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name must be at most 120 characters"),
});

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().max(128).optional(),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be at most 128 characters"),
    confirmPassword: z.string().max(128),
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  });

export async function updateAccountProfile(input: unknown): Promise<ActionResult<{ name: string }>> {
  const session = await requireAuth();
  if (await isActionRateLimited("action", session.user.id)) {
    return { ok: false, error: "Too many updates. Please try again later." };
  }

  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { name } = parsed.data;
  await prisma.user.update({ where: { id: session.user.id }, data: { name } });
  await recordAuditEvent({
    action: "ACCOUNT_PROFILE_UPDATED",
    actorUserId: session.user.id,
    targetType: "User",
    targetId: session.user.id,
  });
  revalidatePath("/account");

  return { ok: true, data: { name } };
}

export async function updateAccountPassword(input: unknown): Promise<ActionResult<{ passwordSet: true }>> {
  const session = await requireAuth();
  if (await isActionRateLimited("auth", session.user.id)) {
    return { ok: false, error: "Too many attempts. Please try again later." };
  }

  const parsed = updatePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, passwordHash: true },
  });
  if (!user?.email) return { ok: false, error: "An email address is required to set a password." };

  if (user.passwordHash) {
    if (!parsed.data.currentPassword) return { ok: false, error: "Enter your current password." };
    if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      return { ok: false, error: "Current password is incorrect." };
    }
  } else if (!(await hasRecentAuthentication())) {
    return { ok: false, error: "Sign in with Google again before adding a password." };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: session.user.id },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });
    await tx.session.deleteMany({ where: { userId: session.user.id } });
    await tx.auditEvent.create({
      data: {
        action: user.passwordHash ? "ACCOUNT_PASSWORD_CHANGED" : "ACCOUNT_PASSWORD_ADDED",
        actorUserId: session.user.id,
        targetType: "User",
        targetId: session.user.id,
      },
    });
  });
  revalidatePath("/account/security");

  return { ok: true, data: { passwordSet: true } };
}
