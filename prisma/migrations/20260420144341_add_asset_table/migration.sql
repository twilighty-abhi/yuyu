-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "key" TEXT NOT NULL,
    "publicUrl" TEXT,
    "contentType" TEXT,
    "byteSize" BIGINT,
    "provider" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_organisationId_idx" ON "Asset"("organisationId");

-- CreateIndex
CREATE INDEX "Asset_createdAt_idx" ON "Asset"("createdAt");

-- CreateIndex
CREATE INDEX "Asset_provider_idx" ON "Asset"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_provider_key_key" ON "Asset"("provider", "key");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
