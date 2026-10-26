-- Large-event read paths (docs/PERFORMANCE.md): composite indexes that let
-- the keyset-paged organiser and public lists read one page in index order
-- instead of sorting every row of the event.
--
-- Purely additive: CREATE INDEX only. No table, column, constraint, type or
-- row changes, and no index is dropped. Prisma runs a migration inside a
-- transaction, so these cannot be CONCURRENTLY; each takes a SHARE lock on
-- its table (reads continue, writes wait) for the few seconds the build
-- takes. On a very large instance an operator may create the same indexes
-- beforehand with CREATE INDEX CONCURRENTLY and the same names; IF NOT
-- EXISTS then makes this migration a no-op.

-- Guests · People (newest first, keyset on createdAt, id) and its deep pages.
CREATE INDEX IF NOT EXISTS "RSVP_eventId_createdAt_id_idx" ON "RSVP"("eventId", "createdAt", "id");

-- Check-in desk and station "Recent check-ins" (newest check-in first).
CREATE INDEX IF NOT EXISTS "RSVP_eventId_checkedInAt_id_idx" ON "RSVP"("eventId", "checkedInAt", "id");

-- Guests · Teams (oldest first, keyset on createdAt, id) and the Teams CSV batches.
CREATE INDEX IF NOT EXISTS "Team_eventId_createdAt_id_idx" ON "Team"("eventId", "createdAt", "id");

-- Judging → Submissions (oldest first, keyset on createdAt, id) and its CSV batches.
CREATE INDEX IF NOT EXISTS "Submission_eventId_createdAt_id_idx" ON "Submission"("eventId", "createdAt", "id");

-- SUBMITTED projects by submission time: the judge workspace (keyset on
-- submittedAt, id), the gallery's newest order, and the ranking's input order.
CREATE INDEX IF NOT EXISTS "Submission_eventId_status_submittedAt_id_idx" ON "Submission"("eventId", "status", "submittedAt", "id");

-- Guests · Invites (newest first, numbered pages).
CREATE INDEX IF NOT EXISTS "EventInvite_eventId_createdAt_id_idx" ON "EventInvite"("eventId", "createdAt", "id");
