-- Judging operations (docs/HACKATHON.md): a target number of judges per
-- project (automatic assignment and the progress dashboard) and the result
-- score normalisation mode. Nullable or defaulted, so existing rows are not
-- rewritten.
CREATE TYPE "ScoreNormalization" AS ENUM ('RAW', 'ZSCORE');

ALTER TABLE "Event" ADD COLUMN "reviewsPerProject" INTEGER;
ALTER TABLE "Event" ADD COLUMN "scoreNormalization" "ScoreNormalization" NOT NULL DEFAULT 'RAW';

ALTER TABLE "Event" ADD CONSTRAINT "Event_reviews_per_project_range"
  CHECK ("reviewsPerProject" IS NULL OR "reviewsPerProject" BETWEEN 1 AND 20);
