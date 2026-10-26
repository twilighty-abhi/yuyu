-- Attendance confirmation (docs/FEATURES.md): an organiser can ask each
-- CONFIRMED guest of a one-off event "Are you still coming?" from the Emails
-- tab. Sending is always a manual organiser action; nothing here schedules
-- anything. Purely additive: a new enum, a new table, and one Event column
-- with a constant default (no existing row is rewritten).
CREATE TYPE "AttendanceResponse" AS ENUM ('ATTENDING', 'NOT_ATTENDING');

ALTER TABLE "Event" ADD COLUMN "attendanceCheckReleaseOnDecline" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AttendanceCheck" (
    "id" TEXT NOT NULL,
    "rsvpId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "response" "AttendanceResponse",
    "respondedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceCheck_pkey" PRIMARY KEY ("id"),
    -- Only the hex SHA-256 digest of the link token is ever stored.
    CONSTRAINT "AttendanceCheck_token_hash_shape" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "AttendanceCheck_note_length" CHECK ("note" IS NULL OR char_length("note") <= 500),
    -- A reply always has its time, and a time always has a reply.
    CONSTRAINT "AttendanceCheck_response_pair" CHECK (("response" IS NULL) = ("respondedAt" IS NULL))
);

-- One question per registration: the unique rsvpId makes sending idempotent.
CREATE UNIQUE INDEX "AttendanceCheck_rsvpId_key" ON "AttendanceCheck"("rsvpId");
CREATE UNIQUE INDEX "AttendanceCheck_tokenHash_key" ON "AttendanceCheck"("tokenHash");
CREATE INDEX "AttendanceCheck_eventId_response_idx" ON "AttendanceCheck"("eventId", "response");

-- The check goes with its registration (cancelled, removed or released) and its event.
ALTER TABLE "AttendanceCheck" ADD CONSTRAINT "AttendanceCheck_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceCheck" ADD CONSTRAINT "AttendanceCheck_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
