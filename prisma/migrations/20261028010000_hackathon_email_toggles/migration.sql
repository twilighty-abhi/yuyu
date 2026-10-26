-- Hackathon emails become opt-in per event (docs/HACKATHON.md). Purely
-- additive: existing events get false, so publishing results or submitting a
-- project queues no email until an organiser turns the matching switch on.
ALTER TABLE "Event" ADD COLUMN "emailEntrantsOnResults" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "emailSubmissionReceipts" BOOLEAN NOT NULL DEFAULT false;
