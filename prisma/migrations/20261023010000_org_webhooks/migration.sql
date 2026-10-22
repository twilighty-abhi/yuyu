-- Outgoing organisation webhooks (docs/WEBHOOKS.md).
-- Purely additive: one new enum and two new tables with their indexes,
-- checks, and foreign keys. No existing table, type, or row is changed.

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "eventTypes" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "secretEncrypted" TEXT NOT NULL,
    "disabledReason" TEXT,
    "disabledAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- The same bounds as the Server Action schema, even if a future code path
-- skips validation.
ALTER TABLE "WebhookEndpoint"
  ADD CONSTRAINT "WebhookEndpoint_url_length" CHECK (char_length("url") BETWEEN 1 AND 2048),
  ADD CONSTRAINT "WebhookEndpoint_description_length" CHECK (char_length("description") <= 200),
  ADD CONSTRAINT "WebhookEndpoint_event_types_bounded" CHECK (cardinality("eventTypes") <= 16),
  ADD CONSTRAINT "WebhookEndpoint_failures_nonnegative" CHECK ("consecutiveFailures" >= 0);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "responseTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- A claimed row always carries its lease; other states never do.
ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_attempts_nonnegative" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "WebhookDelivery_lease_shape" CHECK (("status" = 'PROCESSING') = ("lockedAt" IS NOT NULL)),
  ADD CONSTRAINT "WebhookDelivery_last_error_length" CHECK ("lastError" IS NULL OR char_length("lastError") <= 300);

-- CreateIndex
CREATE INDEX "WebhookEndpoint_organisationId_enabled_idx" ON "WebhookEndpoint"("organisationId", "enabled");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_organisationId_createdAt_idx" ON "WebhookDelivery"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
