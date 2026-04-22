-- CreateEnum
CREATE TYPE "RegistrationFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'SELECT', 'MULTI_SELECT', 'RADIO', 'CHECKBOX', 'NUMBER', 'DATE');

-- AlterTable
ALTER TABLE "RSVP" ADD COLUMN     "guestName" TEXT;

-- CreateTable
CREATE TABLE "EventRegistrationForm" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRegistrationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRegistrationField" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "RegistrationFieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventRegistrationField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RsvpAnswer" (
    "id" TEXT NOT NULL,
    "rsvpId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueBool" BOOLEAN,
    "valueNumber" DOUBLE PRECISION,
    "valueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RsvpAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistrationForm_eventId_key" ON "EventRegistrationForm"("eventId");

-- CreateIndex
CREATE INDEX "EventRegistrationForm_eventId_idx" ON "EventRegistrationForm"("eventId");

-- CreateIndex
CREATE INDEX "EventRegistrationField_formId_sortOrder_idx" ON "EventRegistrationField"("formId", "sortOrder");

-- CreateIndex
CREATE INDEX "EventRegistrationField_formId_type_idx" ON "EventRegistrationField"("formId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "EventRegistrationField_formId_key_key" ON "EventRegistrationField"("formId", "key");

-- CreateIndex
CREATE INDEX "RsvpAnswer_rsvpId_idx" ON "RsvpAnswer"("rsvpId");

-- CreateIndex
CREATE INDEX "RsvpAnswer_fieldId_idx" ON "RsvpAnswer"("fieldId");

-- CreateIndex
CREATE INDEX "RsvpAnswer_rsvpId_fieldId_idx" ON "RsvpAnswer"("rsvpId", "fieldId");

-- AddForeignKey
ALTER TABLE "EventRegistrationForm" ADD CONSTRAINT "EventRegistrationForm_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRegistrationField" ADD CONSTRAINT "EventRegistrationField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "EventRegistrationForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RsvpAnswer" ADD CONSTRAINT "RsvpAnswer_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RsvpAnswer" ADD CONSTRAINT "RsvpAnswer_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "EventRegistrationField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
