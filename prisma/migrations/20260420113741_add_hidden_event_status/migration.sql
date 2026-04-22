-- AlterEnum
ALTER TYPE "EventStatus" ADD VALUE 'HIDDEN';

-- CreateIndex
CREATE INDEX "Event_organisationId_idx" ON "Event"("organisationId");
