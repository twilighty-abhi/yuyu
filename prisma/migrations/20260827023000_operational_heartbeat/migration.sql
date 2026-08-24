CREATE TABLE "OperationalHeartbeat" (
  "key" TEXT NOT NULL,
  "lastStartedAt" TIMESTAMP(3),
  "lastSucceededAt" TIMESTAMP(3),
  "lastSent" INTEGER NOT NULL DEFAULT 0,
  "lastFailed" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OperationalHeartbeat_pkey" PRIMARY KEY ("key")
);
