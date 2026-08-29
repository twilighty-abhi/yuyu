ALTER TABLE "Event"
  ADD COLUMN "checkInStationPinHash" TEXT,
  ADD COLUMN "checkInStationSecretVersion" INTEGER NOT NULL DEFAULT 0;
