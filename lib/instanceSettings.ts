import "server-only";

import { prisma } from "@/lib/db";
import { decryptInstanceConfigSecret } from "@/lib/instanceConfigSecrets";

export const INSTANCE_SETTINGS_ID = "global";

/** A missing singleton row intentionally preserves the historical default. */
export async function isNewUserRegistrationEnabled(): Promise<boolean> {
  const settings = await prisma.instanceSetting.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
    select: { allowNewUserSignups: true },
  });
  return settings?.allowNewUserSignups ?? true;
}

export async function getGoogleSsoSettings() {
  const settings = await prisma.instanceSetting.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
    select: { googleClientId: true, googleClientSecretEncrypted: true },
  });
  const clientId = settings?.googleClientId ?? process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID;
  const encryptedSecret = settings?.googleClientSecretEncrypted;
  const clientSecret = encryptedSecret
    ? decryptInstanceConfigSecret(encryptedSecret)
    : process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function getEmailSettings() {
  const settings = await prisma.instanceSetting.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
    select: {
      emailFrom: true, smtpService: true, smtpHost: true, smtpPort: true,
      smtpSecure: true, smtpUser: true, smtpPasswordEncrypted: true, smtpAllowUnauthenticated: true,
    },
  });
  const configured = Boolean(settings?.smtpService || settings?.smtpHost);
  return {
    from: settings?.emailFrom ?? process.env.EMAIL_FROM ?? "Yuyu Events <noreply@localhost>",
    service: settings?.smtpService ?? process.env.SMTP_SERVICE,
    host: settings?.smtpHost ?? process.env.SMTP_HOST,
    port: settings?.smtpPort ?? parseInt(process.env.SMTP_PORT || "587", 10),
    secure: configured ? settings!.smtpSecure : process.env.SMTP_SECURE === "true",
    user: settings?.smtpUser ?? process.env.SMTP_USER,
    password: settings?.smtpPasswordEncrypted ? decryptInstanceConfigSecret(settings.smtpPasswordEncrypted) : process.env.SMTP_PASSWORD,
    allowUnauthenticated: configured ? settings!.smtpAllowUnauthenticated : process.env.SMTP_ALLOW_UNAUTHENTICATED === "1",
  };
}
