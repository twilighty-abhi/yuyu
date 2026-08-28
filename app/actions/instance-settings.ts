"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { INSTANCE_SETTINGS_ID } from "@/lib/instanceSettings";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { encryptInstanceConfigSecret } from "@/lib/instanceConfigSecrets";
import type { ActionResult } from "./org";

const signupSettingSchema = z.object({ allowNewUserSignups: z.boolean() });
const serviceSettingsSchema = z.object({
  emailFrom: z.string().trim().max(320).optional(),
  smtpService: z.string().trim().max(120).optional(), smtpHost: z.string().trim().max(253).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(), smtpSecure: z.boolean(),
  smtpUser: z.string().trim().max(320).optional(), smtpPassword: z.string().max(1024).optional(), smtpAllowUnauthenticated: z.boolean(),
  googleClientId: z.string().trim().max(320).optional(), googleClientSecret: z.string().max(1024).optional(),
  backupProvider: z.string().trim().max(80).optional(), backupLastSuccessAt: z.string().datetime().optional(),
  backupRetentionDays: z.coerce.number().int().min(1).max(3650).optional(),
}).superRefine((value, ctx) => {
  if (value.smtpService && value.smtpHost) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["smtpHost"], message: "Choose either an SMTP service or a host." });
  if ((value.smtpService || value.smtpHost) && !value.smtpAllowUnauthenticated && !value.smtpUser) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["smtpUser"], message: "SMTP credentials are required unless using a private relay." });
});

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

export async function saveInstanceServiceSettings(input: unknown): Promise<ActionResult> {
  const session = await requireSuperAdminMfa();
  const parsed = serviceSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid instance settings." };
  const value = parsed.data;
  const existing = await prisma.instanceSetting.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
    select: { smtpPasswordEncrypted: true, googleClientSecretEncrypted: true },
  });
  if ((value.smtpService || value.smtpHost) && !value.smtpAllowUnauthenticated && !value.smtpPassword && !existing?.smtpPasswordEncrypted) {
    return { ok: false, error: "Enter an SMTP password or use a deliberately unauthenticated private relay." };
  }
  if (value.googleClientId && !value.googleClientSecret && !existing?.googleClientSecretEncrypted) {
    return { ok: false, error: "Enter the Google OAuth client secret." };
  }
  await prisma.instanceSetting.upsert({
    where: { id: INSTANCE_SETTINGS_ID },
    create: {
      id: INSTANCE_SETTINGS_ID, ...value,
      emailFrom: value.emailFrom || null, smtpService: value.smtpService || null, smtpHost: value.smtpHost || null,
      smtpUser: value.smtpUser || null, googleClientId: value.googleClientId || null,
      backupProvider: value.backupProvider || null, backupLastSuccessAt: value.backupLastSuccessAt ? new Date(value.backupLastSuccessAt) : null,
      smtpPasswordEncrypted: value.smtpPassword ? encryptInstanceConfigSecret(value.smtpPassword) : null,
      googleClientSecretEncrypted: value.googleClientSecret ? encryptInstanceConfigSecret(value.googleClientSecret) : null,
    },
    update: {
      ...value, emailFrom: value.emailFrom || null, smtpService: value.smtpService || null, smtpHost: value.smtpHost || null,
      smtpUser: value.smtpUser || null, googleClientId: value.googleClientId || null,
      backupProvider: value.backupProvider || null, backupLastSuccessAt: value.backupLastSuccessAt ? new Date(value.backupLastSuccessAt) : null,
      ...(value.smtpPassword ? { smtpPasswordEncrypted: encryptInstanceConfigSecret(value.smtpPassword) } : {}),
      ...(value.googleClientSecret ? { googleClientSecretEncrypted: encryptInstanceConfigSecret(value.googleClientSecret) } : {}),
    },
  });
  await recordAuditEvent({
    action: "INSTANCE_SERVICE_SETTINGS_UPDATED", actorUserId: session.user.id, targetType: "InstanceSetting", targetId: INSTANCE_SETTINGS_ID,
    metadata: { smtpConfigured: Boolean(value.smtpService || value.smtpHost), googleSsoConfigured: Boolean(value.googleClientId), backupConfigured: Boolean(value.backupProvider) },
  });
  revalidatePath("/login");
  revalidatePath("/super-admin/settings");
  revalidatePath("/super-admin/operations");
  return { ok: true };
}
