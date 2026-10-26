-- Team registration (docs/TEAMS.md). Purely additive: new enums, three new
-- tables, nullable/defaulted Event and RSVP columns, and constraints that only
-- restrict team settings. Existing events stay INDIVIDUAL with no team sizes,
-- so every new CHECK constraint holds for existing rows without a backfill.

-- CreateEnum
CREATE TYPE "RegistrationMode" AS ENUM ('INDIVIDUAL', 'TEAM');

-- CreateEnum
CREATE TYPE "SoloPolicy" AS ENUM ('TEAMS_ONLY', 'SOLO_ALLOWED', 'SOLO_WITH_MATCHING');

-- CreateEnum
CREATE TYPE "TeamJoinRequestDirection" AS ENUM ('INVITE', 'REQUEST');

-- CreateEnum
CREATE TYPE "TeamJoinRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "registrationMode" "RegistrationMode" NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "soloPolicy" "SoloPolicy" NOT NULL DEFAULT 'SOLO_ALLOWED',
ADD COLUMN     "teamMaxSize" INTEGER,
ADD COLUMN     "teamMinSize" INTEGER;

-- AlterTable
ALTER TABLE "RSVP" ADD COLUMN     "teamId" TEXT;

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "status" "RsvpStatus" NOT NULL,
    "joinToken" TEXT NOT NULL,
    "manageTokenHash" TEXT NOT NULL,
    "leaderRsvpId" TEXT,
    "lookingForMembers" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSeekerProfile" (
    "id" TEXT NOT NULL,
    "rsvpId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSeekerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamJoinRequest" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "rsvpId" TEXT NOT NULL,
    "direction" "TeamJoinRequestDirection" NOT NULL,
    "status" "TeamJoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_joinToken_key" ON "Team"("joinToken");

-- CreateIndex
CREATE UNIQUE INDEX "Team_manageTokenHash_key" ON "Team"("manageTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Team_leaderRsvpId_key" ON "Team"("leaderRsvpId");

-- CreateIndex
CREATE INDEX "Team_eventId_status_createdAt_idx" ON "Team"("eventId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Team_eventId_nameKey_key" ON "Team"("eventId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSeekerProfile_rsvpId_key" ON "TeamSeekerProfile"("rsvpId");

-- CreateIndex
CREATE INDEX "TeamJoinRequest_teamId_status_idx" ON "TeamJoinRequest"("teamId", "status");

-- CreateIndex
CREATE INDEX "TeamJoinRequest_rsvpId_status_idx" ON "TeamJoinRequest"("rsvpId", "status");

-- CreateIndex
CREATE INDEX "RSVP_teamId_idx" ON "RSVP"("teamId");

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leaderRsvpId_fkey" FOREIGN KEY ("leaderRsvpId") REFERENCES "RSVP"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSeekerProfile" ADD CONSTRAINT "TeamSeekerProfile_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamJoinRequest" ADD CONSTRAINT "TeamJoinRequest_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Team sizes stay valid even if a future code path skips validation. TEAM
-- mode always has a maximum size, because joins are checked against it.
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_team_min_size_positive" CHECK ("teamMinSize" IS NULL OR "teamMinSize" >= 1),
  ADD CONSTRAINT "Event_team_max_size_at_least_two" CHECK ("teamMaxSize" IS NULL OR "teamMaxSize" >= 2),
  ADD CONSTRAINT "Event_team_size_order" CHECK ("teamMinSize" IS NULL OR "teamMaxSize" IS NULL OR "teamMaxSize" >= "teamMinSize"),
  ADD CONSTRAINT "Event_team_mode_requires_max_size" CHECK ("registrationMode" <> 'TEAM' OR "teamMaxSize" IS NOT NULL);

-- Seeker profiles list at most 8 skills.
ALTER TABLE "TeamSeekerProfile"
  ADD CONSTRAINT "TeamSeekerProfile_skills_limit" CHECK (cardinality("skills") <= 8);

-- At most one pending invitation or request per team and registration.
-- Answered rows (accepted, declined, cancelled) are kept as history.
CREATE UNIQUE INDEX "TeamJoinRequest_one_pending_per_team_rsvp" ON "TeamJoinRequest"("teamId", "rsvpId") WHERE "status" = 'PENDING';
