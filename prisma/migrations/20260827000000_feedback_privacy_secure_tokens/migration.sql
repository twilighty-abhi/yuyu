-- CUID v1 values are identifiers, not authentication credentials. Rotate all
-- existing bearer credentials to cryptographically random 256-bit values.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "RSVP"
SET "checkInToken" = encode(gen_random_bytes(32), 'hex');

UPDATE "EventFeedbackResponse"
SET "certificateToken" = encode(gen_random_bytes(32), 'hex')
WHERE "certificateToken" IS NOT NULL;

-- Anonymous feedback has no RSVP identity or certificate token. Certificate
-- feedback may reference an RSVP, and repeat responses are intentionally valid.
DROP INDEX IF EXISTS "EventFeedbackResponse_formId_rsvpId_key";
ALTER TABLE "EventFeedbackResponse" ALTER COLUMN "rsvpId" DROP NOT NULL;
ALTER TABLE "EventFeedbackResponse" ALTER COLUMN "certificateToken" DROP NOT NULL;
