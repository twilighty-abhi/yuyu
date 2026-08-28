"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { INSTANCE_SETTINGS_ID } from "@/lib/instanceSettings";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { recordAuditEvent } from "@/lib/audit";
import type { ActionResult } from "./org";

const signupSettingSchema = z.object({ allowNewUserSignups: z.boolean() });

export async function setNewUserRegistrationEnabled(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  const parsed = signupSettingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid account creation setting." };

  await prisma.instanceSetting.upsert({
    where: { id: INSTANCE_SETTINGS_ID },
    create: { id: INSTANCE_SETTINGS_ID, allowNewUserSignups: parsed.data.allowNewUserSignups },
    update: { allowNewUserSignups: parsed.data.allowNewUserSignups },
  });
  await recordAuditEvent({
    action: "NEW_USER_REGISTRATION_SETTING_UPDATED",
    actorUserId: session.user.id,
    targetType: "InstanceSetting",
    targetId: INSTANCE_SETTINGS_ID,
    metadata: { allowNewUserSignups: parsed.data.allowNewUserSignups },
  });
  revalidatePath("/login");
  revalidatePath("/super-admin/auth");
  return { ok: true };
}
