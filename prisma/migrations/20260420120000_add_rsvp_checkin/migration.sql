-- AlterTable: check-in token (backfilled for existing rows) + checked-in timestamp
ALTER TABLE "RSVP" ADD COLUMN "checkInToken" TEXT;
ALTER TABLE "RSVP" ADD COLUMN "checkedInAt" TIMESTAMP(3);

UPDATE "RSVP" SET "checkInToken" = 'ci_' || REPLACE(gen_random_uuid()::text, '-', '')
WHERE "checkInToken" IS NULL;

ALTER TABLE "RSVP" ALTER COLUMN "checkInToken" SET NOT NULL;

CREATE UNIQUE INDEX "RSVP_checkInToken_key" ON "RSVP"("checkInToken");

CREATE INDEX "RSVP_checkInToken_idx" ON "RSVP"("checkInToken");
