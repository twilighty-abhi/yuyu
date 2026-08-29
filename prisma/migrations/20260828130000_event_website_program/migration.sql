CREATE TYPE "EventPageSectionType" AS ENUM ('HERO', 'ABOUT', 'HIGHLIGHTS', 'SCHEDULE', 'SPEAKERS', 'SPONSORS', 'VENUE', 'FAQ', 'RESOURCES');
CREATE TYPE "ContentVisibility" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN');
CREATE TYPE "EventSessionType" AS ENUM ('KEYNOTE', 'TALK', 'PANEL', 'WORKSHOP', 'FIRESIDE_CHAT', 'NETWORKING', 'BREAK', 'OTHER');
CREATE TYPE "SponsorTier" AS ENUM ('PLATINUM', 'GOLD', 'SILVER', 'PARTNER', 'COMMUNITY_PARTNER');
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Standalone schedules are intentionally replaced by the first-class program.
DELETE FROM "EventScheduleItem" WHERE "eventId" IS NOT NULL;
ALTER TABLE "EventScheduleItem" DROP CONSTRAINT "EventScheduleItem_one_target";
ALTER TABLE "EventScheduleItem" DROP CONSTRAINT "EventScheduleItem_eventId_fkey";
DROP INDEX "EventScheduleItem_eventId_sortOrder_idx";
ALTER TABLE "EventScheduleItem" DROP COLUMN "eventId";
ALTER TABLE "EventScheduleItem" ALTER COLUMN "eventSeriesId" SET NOT NULL;

CREATE TABLE "EventPage" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "tagline" TEXT NOT NULL DEFAULT '',
  "logoUrl" TEXT, "accentColor" TEXT, "aboutHtml" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventPage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventPage_eventId_key" ON "EventPage"("eventId");
ALTER TABLE "EventPage" ADD CONSTRAINT "EventPage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "EventPage" ("id", "eventId", "aboutHtml", "createdAt", "updatedAt")
SELECT concat('ep_', "id"), "id",
  CASE WHEN "description" = '' THEN '' ELSE '<p>' || replace(replace(replace("description", '&', '&amp;'), '<', '&lt;'), E'\n', '<br>') || '</p>' END,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Event";

CREATE TABLE "EventPageSection" (
  "id" TEXT NOT NULL, "pageId" TEXT NOT NULL, "type" "EventPageSectionType" NOT NULL,
  "isVisible" BOOLEAN NOT NULL DEFAULT true, "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EventPageSection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventPageSection_pageId_type_key" ON "EventPageSection"("pageId", "type");
CREATE INDEX "EventPageSection_pageId_sortOrder_idx" ON "EventPageSection"("pageId", "sortOrder");
ALTER TABLE "EventPageSection" ADD CONSTRAINT "EventPageSection_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "EventPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "EventPageSection" ("id", "pageId", "type", "sortOrder")
SELECT concat('eps_', p."id", '_', section."type"::text), p."id", section."type", section."sortOrder"
FROM "EventPage" p
CROSS JOIN (VALUES
  ('HERO'::"EventPageSectionType", 0), ('ABOUT'::"EventPageSectionType", 1), ('HIGHLIGHTS'::"EventPageSectionType", 2),
  ('SCHEDULE'::"EventPageSectionType", 3), ('SPEAKERS'::"EventPageSectionType", 4), ('SPONSORS'::"EventPageSectionType", 5),
  ('VENUE'::"EventPageSectionType", 6), ('FAQ'::"EventPageSectionType", 7), ('RESOURCES'::"EventPageSectionType", 8)
) AS section("type", "sortOrder");

CREATE TABLE "EventHighlight" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '', "icon" TEXT,
  "visibility" "ContentVisibility" NOT NULL DEFAULT 'DRAFT', "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EventHighlight_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventHighlight_eventId_sortOrder_idx" ON "EventHighlight"("eventId", "sortOrder");
ALTER TABLE "EventHighlight" ADD CONSTRAINT "EventHighlight_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventVenue" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "name" TEXT NOT NULL, "address" TEXT NOT NULL DEFAULT '', "city" TEXT NOT NULL DEFAULT '', "country" TEXT NOT NULL DEFAULT '',
  "latitude" DECIMAL(9,6), "longitude" DECIMAL(9,6), "mapLinkUrl" TEXT, "directions" TEXT NOT NULL DEFAULT '', "parkingInfo" TEXT NOT NULL DEFAULT '', "publicTransport" TEXT NOT NULL DEFAULT '', "accessibilityInfo" TEXT NOT NULL DEFAULT '', "visibility" "ContentVisibility" NOT NULL DEFAULT 'DRAFT',
  CONSTRAINT "EventVenue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventVenue_eventId_key" ON "EventVenue"("eventId");
ALTER TABLE "EventVenue" ADD CONSTRAINT "EventVenue_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventVenueRoom" (
  "id" TEXT NOT NULL, "venueId" TEXT NOT NULL, "name" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EventVenueRoom_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventVenueRoom_venueId_name_key" ON "EventVenueRoom"("venueId", "name");
CREATE INDEX "EventVenueRoom_venueId_sortOrder_idx" ON "EventVenueRoom"("venueId", "sortOrder");
ALTER TABLE "EventVenueRoom" ADD CONSTRAINT "EventVenueRoom_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "EventVenue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventSession" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "title" TEXT NOT NULL, "slug" TEXT NOT NULL, "descriptionHtml" TEXT NOT NULL DEFAULT '',
  "startDateTime" TIMESTAMP(3) NOT NULL, "endDateTime" TIMESTAMP(3) NOT NULL, "type" "EventSessionType" NOT NULL DEFAULT 'TALK', "track" TEXT, "roomId" TEXT,
  "visibility" "ContentVisibility" NOT NULL DEFAULT 'DRAFT', "sortOrder" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventSession_eventId_slug_key" ON "EventSession"("eventId", "slug");
CREATE INDEX "EventSession_eventId_startDateTime_sortOrder_idx" ON "EventSession"("eventId", "startDateTime", "sortOrder");
CREATE INDEX "EventSession_roomId_idx" ON "EventSession"("roomId");
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "EventVenueRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EventSpeaker" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL, "photoUrl" TEXT, "headline" TEXT NOT NULL DEFAULT '', "organisation" TEXT NOT NULL DEFAULT '', "bioHtml" TEXT NOT NULL DEFAULT '', "websiteUrl" TEXT, "linkedinUrl" TEXT, "xUrl" TEXT, "visibility" "ContentVisibility" NOT NULL DEFAULT 'DRAFT', "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EventSpeaker_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventSpeaker_eventId_slug_key" ON "EventSpeaker"("eventId", "slug");
CREATE INDEX "EventSpeaker_eventId_sortOrder_idx" ON "EventSpeaker"("eventId", "sortOrder");
ALTER TABLE "EventSpeaker" ADD CONSTRAINT "EventSpeaker_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventSessionSpeaker" (
  "eventSessionId" TEXT NOT NULL, "speakerId" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EventSessionSpeaker_pkey" PRIMARY KEY ("eventSessionId", "speakerId")
);
CREATE INDEX "EventSessionSpeaker_speakerId_sortOrder_idx" ON "EventSessionSpeaker"("speakerId", "sortOrder");
ALTER TABLE "EventSessionSpeaker" ADD CONSTRAINT "EventSessionSpeaker_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventSessionSpeaker" ADD CONSTRAINT "EventSessionSpeaker_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "EventSpeaker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventSponsor" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "name" TEXT NOT NULL, "logoUrl" TEXT, "description" TEXT NOT NULL DEFAULT '', "websiteUrl" TEXT, "tier" "SponsorTier" NOT NULL DEFAULT 'PARTNER', "visibility" "ContentVisibility" NOT NULL DEFAULT 'DRAFT', "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EventSponsor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventSponsor_eventId_tier_sortOrder_idx" ON "EventSponsor"("eventId", "tier", "sortOrder");
ALTER TABLE "EventSponsor" ADD CONSTRAINT "EventSponsor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventFaq" (
  "id" TEXT NOT NULL, "eventId" TEXT NOT NULL, "question" TEXT NOT NULL, "answerHtml" TEXT NOT NULL DEFAULT '', "visibility" "ContentVisibility" NOT NULL DEFAULT 'DRAFT', "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EventFaq_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EventFaq_eventId_sortOrder_idx" ON "EventFaq"("eventId", "sortOrder");
ALTER TABLE "EventFaq" ADD CONSTRAINT "EventFaq_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventResource" (
  "id" TEXT NOT NULL, "eventId" TEXT, "eventSessionId" TEXT, "title" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '', "externalUrl" TEXT, "assetKey" TEXT, "visibility" "ContentVisibility" NOT NULL DEFAULT 'DRAFT', "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "EventResource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventResource_one_parent" CHECK (("eventId" IS NULL) <> ("eventSessionId" IS NULL)),
  CONSTRAINT "EventResource_one_source" CHECK (("externalUrl" IS NULL) <> ("assetKey" IS NULL))
);
CREATE INDEX "EventResource_eventId_sortOrder_idx" ON "EventResource"("eventId", "sortOrder");
CREATE INDEX "EventResource_eventSessionId_sortOrder_idx" ON "EventResource"("eventSessionId", "sortOrder");
ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventResource" ADD CONSTRAINT "EventResource_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
