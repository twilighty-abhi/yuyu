CREATE TYPE "EventPermission" AS ENUM ('EDIT_DETAILS', 'MANAGE_REGISTRATIONS', 'MANAGE_INVITATIONS', 'CHECK_IN', 'PUBLISH_AND_SCHEDULE');

ALTER TABLE "Event"
  ADD COLUMN "registrationClosesAt" TIMESTAMP(3),
  ADD COLUMN "registrationLeadMinutes" INTEGER;

CREATE TABLE "EventCollaborator" (
  "id" TEXT NOT NULL,
  "eventId" TEXT,
  "eventSeriesId" TEXT,
  "userId" TEXT NOT NULL,
  "permissions" "EventPermission"[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventCollaborator_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventCollaborator_eventId_userId_key" ON "EventCollaborator"("eventId", "userId");
CREATE UNIQUE INDEX "EventCollaborator_eventSeriesId_userId_key" ON "EventCollaborator"("eventSeriesId", "userId");
CREATE INDEX "EventCollaborator_userId_idx" ON "EventCollaborator"("userId");
CREATE INDEX "EventCollaborator_eventId_idx" ON "EventCollaborator"("eventId");
CREATE INDEX "EventCollaborator_eventSeriesId_idx" ON "EventCollaborator"("eventSeriesId");
ALTER TABLE "EventCollaborator" ADD CONSTRAINT "EventCollaborator_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCollaborator" ADD CONSTRAINT "EventCollaborator_eventSeriesId_fkey" FOREIGN KEY ("eventSeriesId") REFERENCES "EventSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCollaborator" ADD CONSTRAINT "EventCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventCollaboratorInvite" (
  "id" TEXT NOT NULL,
  "eventId" TEXT,
  "eventSeriesId" TEXT,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "permissions" "EventPermission"[] NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "usedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "EventCollaboratorInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventCollaboratorInvite_tokenHash_key" ON "EventCollaboratorInvite"("tokenHash");
CREATE INDEX "EventCollaboratorInvite_eventId_email_idx" ON "EventCollaboratorInvite"("eventId", "email");
CREATE INDEX "EventCollaboratorInvite_eventSeriesId_email_idx" ON "EventCollaboratorInvite"("eventSeriesId", "email");
CREATE INDEX "EventCollaboratorInvite_expiresAt_idx" ON "EventCollaboratorInvite"("expiresAt");
ALTER TABLE "EventCollaboratorInvite" ADD CONSTRAINT "EventCollaboratorInvite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCollaboratorInvite" ADD CONSTRAINT "EventCollaboratorInvite_eventSeriesId_fkey" FOREIGN KEY ("eventSeriesId") REFERENCES "EventSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCollaboratorInvite" ADD CONSTRAINT "EventCollaboratorInvite_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EventScheduleItem" (
  "id" TEXT NOT NULL,
  "eventId" TEXT,
  "eventSeriesId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "startDateTime" TIMESTAMP(3) NOT NULL,
  "endDateTime" TIMESTAMP(3) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "delayMinutes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventScheduleItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventScheduleItem_eventId_sortOrder_idx" ON "EventScheduleItem"("eventId", "sortOrder");
CREATE INDEX "EventScheduleItem_eventSeriesId_sortOrder_idx" ON "EventScheduleItem"("eventSeriesId", "sortOrder");
ALTER TABLE "EventScheduleItem" ADD CONSTRAINT "EventScheduleItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventScheduleItem" ADD CONSTRAINT "EventScheduleItem_eventSeriesId_fkey" FOREIGN KEY ("eventSeriesId") REFERENCES "EventSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Event" ADD CONSTRAINT "Event_registration_cutoff_mode" CHECK (NOT ("registrationClosesAt" IS NOT NULL AND "registrationLeadMinutes" IS NOT NULL));
ALTER TABLE "EventCollaborator" ADD CONSTRAINT "EventCollaborator_one_target" CHECK (("eventId" IS NULL) <> ("eventSeriesId" IS NULL));
ALTER TABLE "EventCollaboratorInvite" ADD CONSTRAINT "EventCollaboratorInvite_one_target" CHECK (("eventId" IS NULL) <> ("eventSeriesId" IS NULL));
ALTER TABLE "EventScheduleItem" ADD CONSTRAINT "EventScheduleItem_one_target" CHECK (("eventId" IS NULL) <> ("eventSeriesId" IS NULL));
