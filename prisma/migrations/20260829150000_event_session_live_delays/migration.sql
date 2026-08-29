-- Preserve planned session times while allowing live, cascading schedule delays.
ALTER TABLE "EventSession" ADD COLUMN "delayMinutes" INTEGER NOT NULL DEFAULT 0;
