-- Event crew (docs/CREW.md): organising-team members with their own ticket.
-- A crew RSVP is a CONFIRMED, team-less registration on a one-off event and
-- is excluded from capacity counts in application code.

-- AlterEnum
ALTER TYPE "EventPageSectionType" ADD VALUE 'CREW';

-- AlterTable
ALTER TABLE "RSVP" ADD COLUMN     "isCrew" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EventCrewMember" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "rsvpId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "foodPreference" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "photoUrl" TEXT,
    "linkedinUrl" TEXT,
    "showOnPage" BOOLEAN NOT NULL DEFAULT true,
    "joinedViaLink" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCrewMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCrewJoinLink" (
    "eventId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventCrewJoinLink_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventCrewMember_rsvpId_key" ON "EventCrewMember"("rsvpId");

-- CreateIndex
CREATE INDEX "EventCrewMember_eventId_sortOrder_idx" ON "EventCrewMember"("eventId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EventCrewMember_eventId_email_key" ON "EventCrewMember"("eventId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "EventCrewJoinLink_token_key" ON "EventCrewJoinLink"("token");

-- AddForeignKey
ALTER TABLE "EventCrewMember" ADD CONSTRAINT "EventCrewMember_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCrewMember" ADD CONSTRAINT "EventCrewMember_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCrewJoinLink" ADD CONSTRAINT "EventCrewJoinLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every RSVP row so far has isCrew = false, so the check is added NOT VALID
-- (no scan under the ACCESS EXCLUSIVE lock) and validated separately.
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_crew_shape"
  CHECK (NOT "isCrew" OR ("eventId" IS NOT NULL AND "teamId" IS NULL AND "status" = 'CONFIRMED')) NOT VALID;
ALTER TABLE "RSVP" VALIDATE CONSTRAINT "RSVP_crew_shape";
