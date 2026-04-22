-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "mapLinkUrl" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
