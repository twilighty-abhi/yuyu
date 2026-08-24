-- The release-integrity migration added equivalent partial unique indexes
-- under stable contract names. Keeping both doubles write/index maintenance.
DROP INDEX IF EXISTS "RSVP_eventId_attendeeKey_partial";
DROP INDEX IF EXISTS "RSVP_eventInstanceId_attendeeKey_partial";
