import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { prisma } from "@/lib/db";
import { INSTANCE_SETTINGS_ID } from "@/lib/instanceSettings";
import { InstanceServiceSettingsForm } from "@/components/super-admin/InstanceServiceSettingsForm";

export default async function SuperAdminSettingsPage() {
  const settings = await prisma.instanceSetting.findUnique({ where: { id: INSTANCE_SETTINGS_ID } });
  return <Stack spacing={2}><Stack spacing={0.5}><Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>Instance settings</Typography><Typography color="text.secondary">Configure email delivery, Google sign-in, and backup status for this instance. Secrets are encrypted and never displayed.</Typography></Stack><InstanceServiceSettingsForm initial={{ emailFrom: settings?.emailFrom ?? process.env.EMAIL_FROM ?? "", smtpService: settings?.smtpService ?? process.env.SMTP_SERVICE ?? "", smtpHost: settings?.smtpHost ?? process.env.SMTP_HOST ?? "", smtpPort: String(settings?.smtpPort ?? process.env.SMTP_PORT ?? "587"), smtpSecure: settings?.smtpSecure ?? (process.env.SMTP_SECURE === "true"), smtpUser: settings?.smtpUser ?? process.env.SMTP_USER ?? "", smtpAllowUnauthenticated: settings?.smtpAllowUnauthenticated ?? (process.env.SMTP_ALLOW_UNAUTHENTICATED === "1"), googleClientId: settings?.googleClientId ?? process.env.AUTH_GOOGLE_ID ?? "", backupProvider: settings?.backupProvider ?? process.env.BACKUP_PROVIDER ?? "", backupLastSuccessAt: settings?.backupLastSuccessAt ? settings.backupLastSuccessAt.toISOString().slice(0, 16) : "", backupRetentionDays: String(settings?.backupRetentionDays ?? process.env.BACKUP_RETENTION_DAYS ?? ""), hasSmtpPassword: Boolean(settings?.smtpPasswordEncrypted ?? process.env.SMTP_PASSWORD), hasGoogleClientSecret: Boolean(settings?.googleClientSecretEncrypted ?? process.env.AUTH_GOOGLE_SECRET) }} /></Stack>;
}
