-- Preserve the exact question semantics attached to historical answers. Form
-- maintenance must never erase or reinterpret already submitted feedback.
ALTER TABLE "EventFeedbackAnswer"
  ADD COLUMN "fieldKey" TEXT,
  ADD COLUMN "fieldLabel" TEXT,
  ADD COLUMN "fieldType" "RegistrationFieldType";

UPDATE "EventFeedbackAnswer" AS answer
SET "fieldKey" = field."key",
    "fieldLabel" = field."label",
    "fieldType" = field."type"
FROM "EventFeedbackField" AS field
WHERE field."id" = answer."fieldId";

ALTER TABLE "EventFeedbackAnswer" ALTER COLUMN "fieldKey" SET NOT NULL;
ALTER TABLE "EventFeedbackAnswer" ALTER COLUMN "fieldLabel" SET NOT NULL;
ALTER TABLE "EventFeedbackAnswer" ALTER COLUMN "fieldType" SET NOT NULL;
ALTER TABLE "EventFeedbackAnswer" ALTER COLUMN "fieldId" DROP NOT NULL;

ALTER TABLE "EventFeedbackAnswer" DROP CONSTRAINT "EventFeedbackAnswer_fieldId_fkey";
ALTER TABLE "EventFeedbackAnswer" ADD CONSTRAINT "EventFeedbackAnswer_fieldId_fkey"
  FOREIGN KEY ("fieldId") REFERENCES "EventFeedbackField"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Anonymous responses have neither identity nor certificate capability;
-- certificate responses have both. Prevent partial linkage states.
ALTER TABLE "EventFeedbackResponse" ADD CONSTRAINT "EventFeedbackResponse_identity_capability_pair"
  CHECK (("rsvpId" IS NULL AND "certificateToken" IS NULL)
      OR ("rsvpId" IS NOT NULL AND "certificateToken" IS NOT NULL)) NOT VALID;

-- Typed answer storage must agree with the immutable field type snapshot and
-- contain exactly the corresponding value column.
ALTER TABLE "EventFeedbackAnswer" ADD CONSTRAINT "EventFeedbackAnswer_typed_value"
  CHECK (
    ("fieldType" IN ('TEXT', 'TEXTAREA', 'EMAIL', 'PHONE', 'SELECT', 'MULTI_SELECT', 'RADIO')
      AND "valueText" IS NOT NULL AND "valueBool" IS NULL AND "valueNumber" IS NULL AND "valueDate" IS NULL)
    OR ("fieldType" = 'CHECKBOX'
      AND "valueText" IS NULL AND "valueBool" IS NOT NULL AND "valueNumber" IS NULL AND "valueDate" IS NULL)
    OR ("fieldType" = 'NUMBER'
      AND "valueText" IS NULL AND "valueBool" IS NULL AND "valueNumber" IS NOT NULL AND "valueDate" IS NULL)
    OR ("fieldType" = 'DATE'
      AND "valueText" IS NULL AND "valueBool" IS NULL AND "valueNumber" IS NULL AND "valueDate" IS NOT NULL)
  ) NOT VALID;

ALTER TABLE "EventFeedbackResponse" VALIDATE CONSTRAINT "EventFeedbackResponse_identity_capability_pair";
ALTER TABLE "EventFeedbackAnswer" VALIDATE CONSTRAINT "EventFeedbackAnswer_typed_value";
