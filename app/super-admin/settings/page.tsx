import { requireSuperAdminMfa } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getEmailSettingsStatus, getGoogleSsoStatus, INSTANCE_SETTINGS_ID, resolveBackupPosture } from "@/lib/instanceSettings";
import { decryptInstanceConfigSecret } from "@/lib/instanceConfigSecrets";
import { InstanceServiceSettingsForm, type InstanceServiceSettingsFallback } from "@/components/super-admin/InstanceServiceSettingsForm";
import { OpsWebhookSettingsForm } from "@/components/super-admin/OpsWebhookSettingsForm";
import { PageHeader } from "@/components/ui/display";
import { HelpLink } from "@/components/help/HelpLink";

/** Only the host of the write-only webhook URL is shown; its path is the credential. */
function webhookHost(encrypted: string | null | undefined) {
  if (!encrypted) return null;
  try {
    return new URL(decryptInstanceConfigSecret(encrypted)).host;
  } catch {
    return "a saved webhook (unreadable; enter it again)";
  }
}

/** `datetime-local` value in UTC; the form labels and submits it as UTC. */
function utcInputValue(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 16) : "";
}

export default async function SuperAdminSettingsPage() {
  // Layout checks don't re-run on client navigation, so every page checks too.
  await requireSuperAdminMfa();
  const [settings, email, google] = await Promise.all([
    prisma.instanceSetting.findUnique({ where: { id: INSTANCE_SETTINGS_ID } }),
    getEmailSettingsStatus(),
    getGoogleSsoStatus(),
  ]);
  const backup = resolveBackupPosture(settings);

  // The form holds saved values only; environment fallbacks are shown as
  // placeholders and notes so saving never copies them into the database.
  const fallback: InstanceServiceSettingsFallback = {
    smtpNote: email.source === "database"
      ? "Using the SMTP settings saved here; SMTP_* environment values are ignored. Clear both Service and Host to fall back to the environment."
      : email.source === "environment"
        ? `Not saved here. Email currently uses the environment configuration (${email.service ? `service ${email.service}` : `host ${email.host}:${email.port}`}${email.secure ? ", implicit TLS" : ""}, ${email.user ? "username set" : "no username"}, ${email.hasPassword ? "password set" : "no password"}). Saving a service or host here replaces it entirely.`
        : "Email delivery is not configured. Enter a service or a host.",
    emailFromNote: email.fromSource === "database" ? undefined
      : email.fromSource === "environment" ? `Not saved here; using EMAIL_FROM from the environment: ${email.from}`
        : `Not saved here; using the default: ${email.from}`,
    googleNote: google.source === "database"
      ? google.hasSecret ? "Using the Google client saved here; environment values are ignored. Clear the client ID to turn Google sign-in off or fall back to the environment."
        : "The saved client ID has no secret, so Google sign-in is off until you enter one."
      : google.source === "environment"
        ? `Not saved here. Google sign-in uses the environment client ${google.clientId}${google.hasSecret ? "" : " (secret missing, so sign-in is off)"}. Saving a client ID here replaces it.`
        : "Google sign-in is off.",
    backupNote: backup.source === "environment"
      ? "Not saved here; Operations shows the BACKUP_* environment values (shown as placeholders). Saving any backup value here replaces them."
      : undefined,
    smtpPasswordUnreadable: email.source === "database" && email.passwordUnreadable,
    googleSecretUnreadable: google.secretUnreadable,
    placeholders: {
      emailFrom: email.fromSource === "database" ? undefined : email.from,
      ...(email.source === "environment" ? {
        smtpService: email.service, smtpHost: email.host,
        smtpPort: email.service ? undefined : String(email.port), smtpUser: email.user,
      } : {}),
      ...(google.source === "environment" ? { googleClientId: google.clientId } : {}),
      ...(backup.source === "environment" ? {
        backupProvider: backup.provider,
        backupRetentionDays: backup.retentionDays ? String(backup.retentionDays) : undefined,
      } : {}),
    },
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Instance settings" description="Configure email delivery, Google sign-in, backup status, and operational alerts for this instance. Secrets are encrypted and never displayed." actions={<HelpLink article="instance/settings" />} />
      <InstanceServiceSettingsForm
        fallback={fallback}
        initial={{
          emailFrom: settings?.emailFrom ?? "",
          smtpService: settings?.smtpService ?? "",
          smtpHost: settings?.smtpHost ?? "",
          smtpPort: settings?.smtpPort ? String(settings.smtpPort) : "",
          smtpSecure: settings?.smtpSecure ?? false,
          smtpUser: settings?.smtpUser ?? "",
          smtpAllowUnauthenticated: settings?.smtpAllowUnauthenticated ?? false,
          googleClientId: settings?.googleClientId ?? "",
          backupProvider: settings?.backupProvider ?? "",
          backupLastSuccessAt: utcInputValue(settings?.backupLastSuccessAt),
          backupRetentionDays: settings?.backupRetentionDays ? String(settings.backupRetentionDays) : "",
          hasSmtpPassword: Boolean(settings?.smtpPasswordEncrypted),
          hasGoogleClientSecret: Boolean(settings?.googleClientSecretEncrypted),
        }}
      />
      <OpsWebhookSettingsForm initial={{ enabled: settings?.opsWebhookEnabled ?? false, includeWarnings: settings?.opsWebhookIncludeWarnings ?? true, configuredHost: webhookHost(settings?.opsWebhookUrlEncrypted) }} />
    </div>
  );
}
