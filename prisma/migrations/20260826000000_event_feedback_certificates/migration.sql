CREATE TABLE "EventFeedbackForm" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT 'Event feedback',
    "thankYouMessage" TEXT NOT NULL DEFAULT 'Thanks for sharing your feedback.',
    "certificateEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventFeedbackForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventFeedbackField" (
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
    CONSTRAINT "EventFeedbackField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventFeedbackResponse" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "rsvpId" TEXT NOT NULL,
    "certificateToken" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventFeedbackResponse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventFeedbackAnswer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueBool" BOOLEAN,
    "valueNumber" DOUBLE PRECISION,
    "valueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventFeedbackAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventFeedbackForm_eventId_key" ON "EventFeedbackForm"("eventId");
CREATE UNIQUE INDEX "EventFeedbackField_formId_key_key" ON "EventFeedbackField"("formId", "key");
CREATE UNIQUE INDEX "EventFeedbackResponse_certificateToken_key" ON "EventFeedbackResponse"("certificateToken");
CREATE UNIQUE INDEX "EventFeedbackResponse_formId_rsvpId_key" ON "EventFeedbackResponse"("formId", "rsvpId");
CREATE INDEX "EventFeedbackField_formId_sortOrder_idx" ON "EventFeedbackField"("formId", "sortOrder");
CREATE INDEX "EventFeedbackResponse_rsvpId_idx" ON "EventFeedbackResponse"("rsvpId");
CREATE INDEX "EventFeedbackAnswer_responseId_idx" ON "EventFeedbackAnswer"("responseId");
CREATE INDEX "EventFeedbackAnswer_fieldId_idx" ON "EventFeedbackAnswer"("fieldId");

ALTER TABLE "EventFeedbackForm" ADD CONSTRAINT "EventFeedbackForm_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventFeedbackField" ADD CONSTRAINT "EventFeedbackField_formId_fkey" FOREIGN KEY ("formId") REFERENCES "EventFeedbackForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventFeedbackResponse" ADD CONSTRAINT "EventFeedbackResponse_formId_fkey" FOREIGN KEY ("formId") REFERENCES "EventFeedbackForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventFeedbackResponse" ADD CONSTRAINT "EventFeedbackResponse_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventFeedbackAnswer" ADD CONSTRAINT "EventFeedbackAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "EventFeedbackResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventFeedbackAnswer" ADD CONSTRAINT "EventFeedbackAnswer_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "EventFeedbackField"("id") ON DELETE CASCADE ON UPDATE CASCADE;
