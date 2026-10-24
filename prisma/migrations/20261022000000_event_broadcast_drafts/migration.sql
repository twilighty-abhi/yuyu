-- Saved drafts for organiser email broadcasts (the event Emails tab).
-- Purely additive: one new table with its indexes, checks, and foreign keys.
-- No existing table, type, or row is changed.

-- CreateTable
CREATE TABLE "EventBroadcastDraft" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "design" TEXT NOT NULL DEFAULT 'classic',
    "statuses" "RsvpStatus"[] DEFAULT ARRAY[]::"RsvpStatus"[],
    "attendance" "BroadcastAttendanceFilter" NOT NULL DEFAULT 'ANY',
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventBroadcastDraft_pkey" PRIMARY KEY ("id")
);

-- The same bounds as the send schema, even if a future code path skips
-- validation: a subject of at most 150 characters and at most the four
-- registration statuses.
ALTER TABLE "EventBroadcastDraft"
  ADD CONSTRAINT "EventBroadcastDraft_subject_length" CHECK (char_length("subject") <= 150),
  ADD CONSTRAINT "EventBroadcastDraft_statuses_bounded" CHECK (cardinality("statuses") <= 4);

-- CreateIndex
CREATE UNIQUE INDEX "EventBroadcastDraft_eventId_userId_key" ON "EventBroadcastDraft"("eventId", "userId");

-- CreateIndex
CREATE INDEX "EventBroadcastDraft_userId_idx" ON "EventBroadcastDraft"("userId");

-- AddForeignKey
ALTER TABLE "EventBroadcastDraft" ADD CONSTRAINT "EventBroadcastDraft_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventBroadcastDraft" ADD CONSTRAINT "EventBroadcastDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
