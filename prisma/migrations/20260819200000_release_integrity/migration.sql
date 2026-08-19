-- A person may register only once for a specific event or recurring occurrence.
-- Partial indexes retain the existing nullable event/instance representation.
CREATE UNIQUE INDEX "RSVP_event_attendee_unique"
  ON "RSVP" ("eventId", "attendeeKey")
  WHERE "eventId" IS NOT NULL;

CREATE UNIQUE INDEX "RSVP_instance_attendee_unique"
  ON "RSVP" ("eventInstanceId", "attendeeKey")
  WHERE "eventInstanceId" IS NOT NULL;

-- JWT sessions are invalidated by incrementing this value after account recovery.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
