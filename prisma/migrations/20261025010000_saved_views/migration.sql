-- Saved views (docs/FEATURES.md): named filter/search states on the event
-- dashboard's paged lists (Guests People/Teams, Judging Submissions/Results/
-- Progress). A new table only; no existing row is rewritten. A view belongs
-- to its event, organisation and creator and goes with any of them.
CREATE TYPE "SavedViewSurface" AS ENUM ('GUESTS_PEOPLE', 'GUESTS_TEAMS', 'JUDGING_SUBMISSIONS', 'JUDGING_RESULTS', 'JUDGING_PROGRESS');

CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "surface" "SavedViewSurface" NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SavedView_name_length" CHECK (char_length("name") BETWEEN 1 AND 60),
    CONSTRAINT "SavedView_params_object" CHECK (jsonb_typeof("params") = 'object')
);

CREATE INDEX "SavedView_eventId_surface_idx" ON "SavedView"("eventId", "surface");
CREATE INDEX "SavedView_userId_idx" ON "SavedView"("userId");
CREATE INDEX "SavedView_organisationId_idx" ON "SavedView"("organisationId");

ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
