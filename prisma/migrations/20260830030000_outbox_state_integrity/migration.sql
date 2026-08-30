-- Normalize existing queue rows before enforcing the worker state machine.
-- Terminal capability-bearing messages have no operational value and must not
-- retain ticket/reset/verification/invitation bearer values after this upgrade.
DELETE FROM "OutboxMessage"
WHERE "status" IN ('SENT', 'FAILED')
  AND (
    "kind" IN ('rsvp-confirmation', 'password-reset', 'email-verification', 'collaborator-invite')
    OR ("kind" = 'rsvp-status' AND "payload" ? 'checkInToken')
  );

-- Older provider errors may contain recipients, URLs, or connection details.
UPDATE "OutboxMessage"
SET "lastError" = 'Legacy delivery failure detail redacted'
WHERE "lastError" IS NOT NULL;

UPDATE "OperationalHeartbeat"
SET "lastError" = 'Legacy scheduler failure detail redacted'
WHERE "lastError" IS NOT NULL;

UPDATE "OutboxMessage"
SET "lockedAt" = NULL
WHERE "status" <> 'PROCESSING';

UPDATE "OutboxMessage"
SET "lockedAt" = COALESCE("lockedAt", NOW())
WHERE "status" = 'PROCESSING';

UPDATE "OutboxMessage"
SET "sentAt" = COALESCE("sentAt", "createdAt")
WHERE "status" = 'SENT';

UPDATE "OutboxMessage"
SET "sentAt" = NULL
WHERE "status" <> 'SENT';

ALTER TABLE "OutboxMessage"
  ADD CONSTRAINT "OutboxMessage_attempts_nonnegative"
  CHECK ("attempts" >= 0),
  ADD CONSTRAINT "OutboxMessage_state_shape"
  CHECK (
    ("status" = 'PROCESSING' AND "lockedAt" IS NOT NULL AND "sentAt" IS NULL)
    OR ("status" = 'SENT' AND "lockedAt" IS NULL AND "sentAt" IS NOT NULL)
    OR ("status" IN ('PENDING', 'FAILED') AND "lockedAt" IS NULL AND "sentAt" IS NULL)
  );
