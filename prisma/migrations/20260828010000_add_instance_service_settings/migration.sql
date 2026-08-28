ALTER TABLE "InstanceSetting"
  ADD COLUMN "emailFrom" TEXT,
  ADD COLUMN "smtpService" TEXT,
  ADD COLUMN "smtpHost" TEXT,
  ADD COLUMN "smtpPort" INTEGER,
  ADD COLUMN "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "smtpUser" TEXT,
  ADD COLUMN "smtpPasswordEncrypted" TEXT,
  ADD COLUMN "smtpAllowUnauthenticated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "googleClientId" TEXT,
  ADD COLUMN "googleClientSecretEncrypted" TEXT,
  ADD COLUMN "backupProvider" TEXT,
  ADD COLUMN "backupLastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "backupRetentionDays" INTEGER;
