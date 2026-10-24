-- Hackathon submissions, judging, and results (docs/HACKATHON.md). Purely
-- additive: two new enums, one new EventPermission value, defaulted or
-- nullable Event columns, and eight new tables. Existing events get
-- submissionsEnabled = false and judgingStatus = NOT_STARTED, so every new
-- CHECK constraint holds for existing rows without a backfill.
--
-- The new JUDGE enum value is not used by this migration, so adding it inside
-- the migration transaction is safe on PostgreSQL 12 and later.

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'WITHDRAWN', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "JudgingStatus" AS ENUM ('NOT_STARTED', 'OPEN', 'CLOSED');

-- AlterEnum
ALTER TYPE "EventPermission" ADD VALUE 'JUDGE';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "judgesSeeAll" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "judgingStatus" "JudgingStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "projectGalleryPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resultsPublishedAt" TIMESTAMP(3),
ADD COLUMN     "submissionsCloseAt" TIMESTAMP(3),
ADD COLUMN     "submissionsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "submissionsOpenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "teamId" TEXT,
    "rsvpId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "repoUrl" TEXT,
    "demoUrl" TEXT,
    "videoUrl" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "disqualifiedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionLink" (
    "id" TEXT NOT NULL,
    "rsvpId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgingCriterion" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "maxScore" INTEGER NOT NULL DEFAULT 10,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgingCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeAssignment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "judgeUserId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeScore" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "judgeUserId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JudgeScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeReview" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "judgeUserId" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JudgeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAward" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAwardWinner" (
    "id" TEXT NOT NULL,
    "awardId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "place" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAwardWinner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Submission_teamId_key" ON "Submission"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_rsvpId_key" ON "Submission"("rsvpId");

-- CreateIndex
CREATE INDEX "Submission_eventId_status_idx" ON "Submission"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionLink_rsvpId_key" ON "SubmissionLink"("rsvpId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionLink_tokenHash_key" ON "SubmissionLink"("tokenHash");

-- CreateIndex
CREATE INDEX "JudgingCriterion_eventId_position_idx" ON "JudgingCriterion"("eventId", "position");

-- CreateIndex
CREATE INDEX "JudgeAssignment_eventId_judgeUserId_idx" ON "JudgeAssignment"("eventId", "judgeUserId");

-- CreateIndex
CREATE INDEX "JudgeAssignment_submissionId_idx" ON "JudgeAssignment"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeAssignment_judgeUserId_submissionId_key" ON "JudgeAssignment"("judgeUserId", "submissionId");

-- CreateIndex
CREATE INDEX "JudgeScore_judgeUserId_idx" ON "JudgeScore"("judgeUserId");

-- CreateIndex
CREATE INDEX "JudgeScore_criterionId_idx" ON "JudgeScore"("criterionId");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeScore_submissionId_judgeUserId_criterionId_key" ON "JudgeScore"("submissionId", "judgeUserId", "criterionId");

-- CreateIndex
CREATE INDEX "JudgeReview_judgeUserId_idx" ON "JudgeReview"("judgeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeReview_submissionId_judgeUserId_key" ON "JudgeReview"("submissionId", "judgeUserId");

-- CreateIndex
CREATE INDEX "EventAward_eventId_position_idx" ON "EventAward"("eventId", "position");

-- CreateIndex
CREATE INDEX "EventAwardWinner_submissionId_idx" ON "EventAwardWinner"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "EventAwardWinner_awardId_place_key" ON "EventAwardWinner"("awardId", "place");

-- CreateIndex
CREATE UNIQUE INDEX "EventAwardWinner_awardId_submissionId_key" ON "EventAwardWinner"("awardId", "submissionId");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionLink" ADD CONSTRAINT "SubmissionLink_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgingCriterion" ADD CONSTRAINT "JudgingCriterion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_judgeUserId_fkey" FOREIGN KEY ("judgeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeScore" ADD CONSTRAINT "JudgeScore_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeScore" ADD CONSTRAINT "JudgeScore_judgeUserId_fkey" FOREIGN KEY ("judgeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeScore" ADD CONSTRAINT "JudgeScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "JudgingCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeReview" ADD CONSTRAINT "JudgeReview_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeReview" ADD CONSTRAINT "JudgeReview_judgeUserId_fkey" FOREIGN KEY ("judgeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAward" ADD CONSTRAINT "EventAward_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAwardWinner" ADD CONSTRAINT "EventAwardWinner_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "EventAward"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAwardWinner" ADD CONSTRAINT "EventAwardWinner_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A submission belongs to exactly one entrant: a team or a solo registration.
ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_exactly_one_entrant" CHECK (num_nonnulls("teamId", "rsvpId") = 1),
  ADD CONSTRAINT "Submission_title_length" CHECK (char_length("title") BETWEEN 1 AND 120),
  ADD CONSTRAINT "Submission_summary_length" CHECK (char_length("summary") <= 4000),
  ADD CONSTRAINT "Submission_links_https" CHECK (
    ("repoUrl" IS NULL OR ("repoUrl" LIKE 'https://%' AND char_length("repoUrl") <= 500)) AND
    ("demoUrl" IS NULL OR ("demoUrl" LIKE 'https://%' AND char_length("demoUrl") <= 500)) AND
    ("videoUrl" IS NULL OR ("videoUrl" LIKE 'https://%' AND char_length("videoUrl") <= 500))
  ),
  ADD CONSTRAINT "Submission_disqualified_reason_length" CHECK ("disqualifiedReason" IS NULL OR char_length("disqualifiedReason") <= 500),
  ADD CONSTRAINT "Submission_submitted_has_time" CHECK ("status" NOT IN ('SUBMITTED', 'DISQUALIFIED') OR "submittedAt" IS NOT NULL);

-- The submission window closes after it opens.
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_submission_window_order" CHECK ("submissionsOpenAt" IS NULL OR "submissionsCloseAt" IS NULL OR "submissionsCloseAt" > "submissionsOpenAt");

-- Submission links store only a hex SHA-256 digest.
ALTER TABLE "SubmissionLink"
  ADD CONSTRAINT "SubmissionLink_token_hash_shape" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

-- Rubric lines stay within the documented ranges.
ALTER TABLE "JudgingCriterion"
  ADD CONSTRAINT "JudgingCriterion_weight_range" CHECK ("weight" BETWEEN 1 AND 10),
  ADD CONSTRAINT "JudgingCriterion_max_score_range" CHECK ("maxScore" BETWEEN 1 AND 10),
  ADD CONSTRAINT "JudgingCriterion_name_length" CHECK (char_length("name") BETWEEN 1 AND 80),
  ADD CONSTRAINT "JudgingCriterion_description_length" CHECK (char_length("description") <= 500),
  ADD CONSTRAINT "JudgingCriterion_position_nonnegative" CHECK ("position" >= 0);

-- Scores are never negative; the upper bound (the criterion's maxScore) is
-- checked by lib/core/judging.ts in the write transaction.
ALTER TABLE "JudgeScore"
  ADD CONSTRAINT "JudgeScore_score_range" CHECK ("score" BETWEEN 0 AND 10);

ALTER TABLE "JudgeReview"
  ADD CONSTRAINT "JudgeReview_comment_length" CHECK (char_length("comment") <= 2000);

ALTER TABLE "EventAward"
  ADD CONSTRAINT "EventAward_name_length" CHECK (char_length("name") BETWEEN 1 AND 80),
  ADD CONSTRAINT "EventAward_description_length" CHECK (char_length("description") <= 500),
  ADD CONSTRAINT "EventAward_position_nonnegative" CHECK ("position" >= 0);

ALTER TABLE "EventAwardWinner"
  ADD CONSTRAINT "EventAwardWinner_place_positive" CHECK ("place" >= 1);
