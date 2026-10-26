-- Results announcement marker (docs/HACKATHON.md): set on the first
-- publication so a re-publication never emails anyone twice. Nullable, no
-- default, so existing rows are not rewritten.
ALTER TABLE "Event" ADD COLUMN "resultsAnnouncedAt" TIMESTAMP(3);
