-- Reconcile the migration history with the Prisma Asset model used at runtime.
ALTER TABLE "Asset" ADD COLUMN IF NOT EXISTS "fileData" BYTEA;
DROP INDEX IF EXISTS "Asset_provider_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Asset_key_key" ON "Asset"("key");

-- Every RSVP must belong to exactly one event target. This prevents malformed
-- rows even if an action is called directly rather than through the UI.
ALTER TABLE "RSVP"
  DROP CONSTRAINT IF EXISTS "RSVP_exactly_one_target";
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_exactly_one_target"
  CHECK (("eventId" IS NOT NULL) <> ("eventInstanceId" IS NOT NULL));

-- Server-side, expiring RSVP deletion snapshots. These are deliberately
-- separate from audit history and are only retained long enough for UI undo.
CREATE TABLE IF NOT EXISTS "RsvpDeletionUndo" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "deletedByUserId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RsvpDeletionUndo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RsvpDeletionUndo_organisationId_expiresAt_idx"
  ON "RsvpDeletionUndo"("organisationId", "expiresAt");
CREATE INDEX IF NOT EXISTS "RsvpDeletionUndo_expiresAt_idx" ON "RsvpDeletionUndo"("expiresAt");
ALTER TABLE "RsvpDeletionUndo" DROP CONSTRAINT IF EXISTS "RsvpDeletionUndo_organisationId_fkey";
ALTER TABLE "RsvpDeletionUndo"
  ADD CONSTRAINT "RsvpDeletionUndo_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RsvpDeletionUndo" DROP CONSTRAINT IF EXISTS "RsvpDeletionUndo_deletedByUserId_fkey";
ALTER TABLE "RsvpDeletionUndo"
  ADD CONSTRAINT "RsvpDeletionUndo_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Audit and check-in history must survive organisation/RSVP deletion. Retain
-- the immutable event with a null target rather than cascading it away.
ALTER TABLE "AuditEvent" DROP CONSTRAINT IF EXISTS "AuditEvent_organisationId_fkey";
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CheckInEvent" DROP CONSTRAINT IF EXISTS "CheckInEvent_rsvpId_fkey";
ALTER TABLE "CheckInEvent" ALTER COLUMN "rsvpId" DROP NOT NULL;
ALTER TABLE "CheckInEvent" ADD CONSTRAINT "CheckInEvent_rsvpId_fkey"
  FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE SET NULL ON UPDATE CASCADE;
