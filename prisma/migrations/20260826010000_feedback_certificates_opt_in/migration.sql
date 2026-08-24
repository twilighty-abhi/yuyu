-- Certificates are an explicit organiser choice. Existing forms are switched
-- off as well, so no attendee receives a certificate unexpectedly on deploy.
ALTER TABLE "EventFeedbackForm"
  ALTER COLUMN "certificateEnabled" SET DEFAULT false;

UPDATE "EventFeedbackForm"
SET "certificateEnabled" = false
WHERE "certificateEnabled" = true;
