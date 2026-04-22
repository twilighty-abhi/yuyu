-- CreateTable
CREATE TABLE "SeriesInvite" (
    "id" TEXT NOT NULL,
    "eventSeriesId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeriesInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeriesInvite_eventSeriesId_idx" ON "SeriesInvite"("eventSeriesId");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesInvite_eventSeriesId_email_key" ON "SeriesInvite"("eventSeriesId", "email");

-- AddForeignKey
ALTER TABLE "SeriesInvite" ADD CONSTRAINT "SeriesInvite_eventSeriesId_fkey" FOREIGN KEY ("eventSeriesId") REFERENCES "EventSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
