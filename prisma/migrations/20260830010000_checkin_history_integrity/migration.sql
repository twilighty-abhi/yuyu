-- The application treats this table as immutable operational history. Limit
-- free-form legacy columns to the actions and sources the projection code can
-- actually produce, preventing accidental or compromised write paths from
-- inventing audit semantics.
ALTER TABLE "CheckInEvent" ADD CONSTRAINT "CheckInEvent_known_action"
  CHECK ("action" IN ('CHECKED_IN', 'CHECK_IN_UNDONE')) NOT VALID;
ALTER TABLE "CheckInEvent" ADD CONSTRAINT "CheckInEvent_known_source"
  CHECK ("source" IN ('online', 'offline-sync', 'venue-station')) NOT VALID;

ALTER TABLE "CheckInEvent" VALIDATE CONSTRAINT "CheckInEvent_known_action";
ALTER TABLE "CheckInEvent" VALIDATE CONSTRAINT "CheckInEvent_known_source";
