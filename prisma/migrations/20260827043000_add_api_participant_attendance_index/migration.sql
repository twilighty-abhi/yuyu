-- Serves the confirmed-attendee attendance filters and their stable keyset cursor.
CREATE INDEX "RSVP_eventId_status_checkedInAt_createdAt_id_idx"
ON "RSVP"("eventId", "status", "checkedInAt", "createdAt" DESC, "id" DESC);
