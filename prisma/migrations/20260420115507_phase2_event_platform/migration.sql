-- CreateEnum
CREATE TYPE "EventPrivacyType" AS ENUM ('PUBLIC', 'HIDDEN_LINK', 'APPROVAL_REQUIRED', 'INVITE_ONLY');

-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('CONFIRMED', 'WAITLISTED', 'PENDING_APPROVAL', 'REJECTED');

-- DropIndex
DROP INDEX "RSVP_eventId_attendeeKey_key";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "privacyType" "EventPrivacyType" NOT NULL DEFAULT 'PUBLIC';

-- AlterTable
ALTER TABLE "RSVP" ADD COLUMN     "eventInstanceId" TEXT,
ADD COLUMN     "status" "RsvpStatus" NOT NULL DEFAULT 'CONFIRMED',
ALTER COLUMN "eventId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "EventInvite" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSeries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "recurrenceRule" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "privacyType" "EventPrivacyType" NOT NULL DEFAULT 'PUBLIC',
    "capacity" INTEGER,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventInstance" (
    "id" TEXT NOT NULL,
    "eventSeriesId" TEXT NOT NULL,
    "startDateTime" TIMESTAMP(3) NOT NULL,
    "endDateTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventInvite_eventId_idx" ON "EventInvite"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventInvite_eventId_email_key" ON "EventInvite"("eventId", "email");

-- CreateIndex
CREATE INDEX "EventSeries_organisationId_idx" ON "EventSeries"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "EventSeries_organisationId_slug_key" ON "EventSeries"("organisationId", "slug");

-- CreateIndex
CREATE INDEX "EventInstance_eventSeriesId_startDateTime_idx" ON "EventInstance"("eventSeriesId", "startDateTime");

-- CreateIndex
CREATE INDEX "Event_organisationId_status_privacyType_idx" ON "Event"("organisationId", "status", "privacyType");

-- CreateIndex
CREATE INDEX "RSVP_eventInstanceId_idx" ON "RSVP"("eventInstanceId");

-- CreateIndex
CREATE INDEX "RSVP_eventId_attendeeKey_idx" ON "RSVP"("eventId", "attendeeKey");

-- CreateIndex
CREATE INDEX "RSVP_eventInstanceId_attendeeKey_idx" ON "RSVP"("eventInstanceId", "attendeeKey");

-- AddForeignKey
ALTER TABLE "EventInvite" ADD CONSTRAINT "EventInvite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventInstance" ADD CONSTRAINT "EventInstance_eventSeriesId_fkey" FOREIGN KEY ("eventSeriesId") REFERENCES "EventSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_eventInstanceId_fkey" FOREIGN KEY ("eventInstanceId") REFERENCES "EventInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: legacy hidden (link-only) events → published + hidden link (RSVP enabled per Phase 2)
UPDATE "Event" SET "status" = 'PUBLISHED', "privacyType" = 'HIDDEN_LINK' WHERE "status" = 'HIDDEN';

-- Partial unique indexes: PostgreSQL treats NULLs as distinct in UNIQUE; enforce dedupe per target
CREATE UNIQUE INDEX "RSVP_eventId_attendeeKey_partial" ON "RSVP"("eventId", "attendeeKey") WHERE "eventId" IS NOT NULL;
CREATE UNIQUE INDEX "RSVP_eventInstanceId_attendeeKey_partial" ON "RSVP"("eventInstanceId", "attendeeKey") WHERE "eventInstanceId" IS NOT NULL;
