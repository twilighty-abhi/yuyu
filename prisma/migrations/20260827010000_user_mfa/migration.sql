ALTER TABLE "User"
  ADD COLUMN "mfaSecretEncrypted" TEXT,
  ADD COLUMN "mfaEnabledAt" TIMESTAMP(3),
  ADD COLUMN "recoveryCodeHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
