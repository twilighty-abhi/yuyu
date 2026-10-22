-- Custom check-in lists per event ("Swag collection", "Lunch – Day 1"), the
-- per-list check-in records, and their immutable history.
-- Purely additive: three new tables with their indexes, checks, and foreign
-- keys. No existing table, type, constraint, or row is changed, so entry
-- check-in (RSVP.checkedInAt and CheckInEvent) is untouched.

-- CreateTable
CREATE TABLE "CheckInList" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "requiresEntryCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckInList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInListRecord" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "rsvpId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "source" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInListRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInListEvent" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "rsvpId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInListEvent_pkey" PRIMARY KEY ("id")
);

-- The same bounds as the Zod schema, even if a future code path skips
-- validation: a trimmed, non-empty name of at most 60 characters, a bounded
-- sort position, and the known sources and actions (the list sources mirror
-- the online and mobile values of CheckInEvent_known_source).
ALTER TABLE "CheckInList"
  ADD CONSTRAINT "CheckInList_name_shape" CHECK ("name" = btrim("name") AND char_length("name") BETWEEN 1 AND 60),
  ADD CONSTRAINT "CheckInList_sortOrder_range" CHECK ("sortOrder" BETWEEN 0 AND 10000);
ALTER TABLE "CheckInListRecord"
  ADD CONSTRAINT "CheckInListRecord_known_source" CHECK ("source" IN ('online', 'mobile-scan', 'mobile-manual'));
ALTER TABLE "CheckInListEvent"
  ADD CONSTRAINT "CheckInListEvent_known_action" CHECK ("action" IN ('CHECKED_IN', 'CHECK_IN_UNDONE')),
  ADD CONSTRAINT "CheckInListEvent_known_source" CHECK ("source" IN ('online', 'mobile-scan', 'mobile-manual'));

-- CreateIndex
CREATE INDEX "CheckInList_eventId_archived_sortOrder_idx" ON "CheckInList"("eventId", "archived", "sortOrder");

-- A list name is unique per event among non-archived lists, ignoring case.
-- Archiving frees the name; restoring a list whose name is taken again fails
-- on this index. Prisma cannot model a partial expression index, so it is
-- declared only here.
CREATE UNIQUE INDEX "CheckInList_eventId_active_name_key" ON "CheckInList"("eventId", lower("name")) WHERE NOT "archived";

-- CreateIndex
CREATE UNIQUE INDEX "CheckInListRecord_listId_rsvpId_key" ON "CheckInListRecord"("listId", "rsvpId");

-- CreateIndex
CREATE INDEX "CheckInListRecord_rsvpId_idx" ON "CheckInListRecord"("rsvpId");

-- CreateIndex
CREATE INDEX "CheckInListRecord_actorUserId_idx" ON "CheckInListRecord"("actorUserId");

-- CreateIndex
CREATE INDEX "CheckInListEvent_listId_occurredAt_idx" ON "CheckInListEvent"("listId", "occurredAt");

-- CreateIndex
CREATE INDEX "CheckInListEvent_rsvpId_occurredAt_idx" ON "CheckInListEvent"("rsvpId", "occurredAt");

-- CreateIndex
CREATE INDEX "CheckInListEvent_actorUserId_occurredAt_idx" ON "CheckInListEvent"("actorUserId", "occurredAt");

-- AddForeignKey
ALTER TABLE "CheckInList" ADD CONSTRAINT "CheckInList_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInListRecord" ADD CONSTRAINT "CheckInListRecord_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CheckInList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInListRecord" ADD CONSTRAINT "CheckInListRecord_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInListRecord" ADD CONSTRAINT "CheckInListRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInListEvent" ADD CONSTRAINT "CheckInListEvent_listId_fkey" FOREIGN KEY ("listId") REFERENCES "CheckInList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInListEvent" ADD CONSTRAINT "CheckInListEvent_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInListEvent" ADD CONSTRAINT "CheckInListEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
