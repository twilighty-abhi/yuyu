-- Enforce time/range invariants relied on by registration, recurrence, and
-- program code. NOT VALID permits a controlled validation step with an
-- actionable constraint name if legacy data violates an invariant.
ALTER TABLE "Event" ADD CONSTRAINT "Event_valid_time_range"
  CHECK ("endDateTime" > "startDateTime") NOT VALID;
ALTER TABLE "Event" ADD CONSTRAINT "Event_positive_capacity"
  CHECK ("capacity" IS NULL OR "capacity" > 0) NOT VALID;
ALTER TABLE "Event" ADD CONSTRAINT "Event_nonnegative_registration_lead"
  CHECK ("registrationLeadMinutes" IS NULL OR "registrationLeadMinutes" >= 0) NOT VALID;
ALTER TABLE "Event" ADD CONSTRAINT "Event_nonnegative_station_version"
  CHECK ("checkInStationSecretVersion" >= 0) NOT VALID;
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_positive_capacity"
  CHECK ("capacity" IS NULL OR "capacity" > 0) NOT VALID;
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_positive_duration"
  CHECK ("instanceDurationMs" > 0) NOT VALID;
ALTER TABLE "EventInstance" ADD CONSTRAINT "EventInstance_valid_time_range"
  CHECK ("endDateTime" > "startDateTime") NOT VALID;
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_valid_time_range"
  CHECK ("endDateTime" > "startDateTime") NOT VALID;
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_valid_delay"
  CHECK ("delayMinutes" BETWEEN 0 AND 1440) NOT VALID;
ALTER TABLE "EventScheduleItem" ADD CONSTRAINT "EventScheduleItem_valid_time_range"
  CHECK ("endDateTime" > "startDateTime") NOT VALID;
ALTER TABLE "EventScheduleItem" ADD CONSTRAINT "EventScheduleItem_valid_delay"
  CHECK ("delayMinutes" BETWEEN -720 AND 1440) NOT VALID;
ALTER TABLE "OrganisationInvite" ADD CONSTRAINT "OrganisationInvite_usage_pair"
  CHECK ("usedByUserId" IS NULL OR "usedAt" IS NOT NULL) NOT VALID;
ALTER TABLE "EventCollaboratorInvite" ADD CONSTRAINT "EventCollaboratorInvite_usage_pair"
  CHECK ("usedByUserId" IS NULL OR "usedAt" IS NOT NULL) NOT VALID;

ALTER TABLE "Event" VALIDATE CONSTRAINT "Event_valid_time_range";
ALTER TABLE "Event" VALIDATE CONSTRAINT "Event_positive_capacity";
ALTER TABLE "Event" VALIDATE CONSTRAINT "Event_nonnegative_registration_lead";
ALTER TABLE "Event" VALIDATE CONSTRAINT "Event_nonnegative_station_version";
ALTER TABLE "EventSeries" VALIDATE CONSTRAINT "EventSeries_positive_capacity";
ALTER TABLE "EventSeries" VALIDATE CONSTRAINT "EventSeries_positive_duration";
ALTER TABLE "EventInstance" VALIDATE CONSTRAINT "EventInstance_valid_time_range";
ALTER TABLE "EventSession" VALIDATE CONSTRAINT "EventSession_valid_time_range";
ALTER TABLE "EventSession" VALIDATE CONSTRAINT "EventSession_valid_delay";
ALTER TABLE "EventScheduleItem" VALIDATE CONSTRAINT "EventScheduleItem_valid_time_range";
ALTER TABLE "EventScheduleItem" VALIDATE CONSTRAINT "EventScheduleItem_valid_delay";
ALTER TABLE "OrganisationInvite" VALIDATE CONSTRAINT "OrganisationInvite_usage_pair";
ALTER TABLE "EventCollaboratorInvite" VALIDATE CONSTRAINT "EventCollaboratorInvite_usage_pair";

-- Restore the cascade-safe audit function after the heartbeat migration and
-- include collaborator grants/invitations introduced later in the chain.
CREATE OR REPLACE FUNCTION "write_security_audit_fallback"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_data jsonb;
  organisation_id text;
  target_id text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  target_id := row_data ->> 'id';
  IF TG_OP = 'DELETE' THEN
    organisation_id := NULL;
  ELSE
    organisation_id := CASE TG_TABLE_NAME
      WHEN 'Organisation' THEN target_id
      WHEN 'Membership' THEN row_data ->> 'organisationId'
      WHEN 'Event' THEN row_data ->> 'organisationId'
      WHEN 'EventSeries' THEN row_data ->> 'organisationId'
      WHEN 'OrganisationInvite' THEN row_data ->> 'organisationId'
      ELSE NULL
    END;
    IF TG_TABLE_NAME IN ('EventInvite', 'EventCollaborator', 'EventCollaboratorInvite')
       AND row_data ->> 'eventId' IS NOT NULL THEN
      SELECT "organisationId" INTO organisation_id FROM "Event" WHERE "id" = row_data ->> 'eventId';
    ELSIF TG_TABLE_NAME IN ('SeriesInvite', 'EventCollaborator', 'EventCollaboratorInvite')
       AND row_data ->> 'eventSeriesId' IS NOT NULL THEN
      SELECT "organisationId" INTO organisation_id FROM "EventSeries" WHERE "id" = row_data ->> 'eventSeriesId';
    ELSIF TG_TABLE_NAME = 'RSVP' THEN
      IF row_data ->> 'eventId' IS NOT NULL THEN
        SELECT "organisationId" INTO organisation_id FROM "Event" WHERE "id" = row_data ->> 'eventId';
      ELSE
        SELECT s."organisationId" INTO organisation_id
        FROM "EventInstance" i INNER JOIN "EventSeries" s ON s."id" = i."eventSeriesId"
        WHERE i."id" = row_data ->> 'eventInstanceId';
      END IF;
    END IF;
  END IF;
  INSERT INTO "AuditEvent" ("id", "action", "organisationId", "targetType", "targetId", "metadata", "createdAt")
  VALUES (gen_random_uuid()::text, 'DB_' || upper(TG_TABLE_NAME) || '_' || TG_OP,
          organisation_id, TG_TABLE_NAME, target_id,
          jsonb_build_object('source', 'database-trigger'), CURRENT_TIMESTAMP);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS "audit_fallback_eventcollaborator" ON "EventCollaborator";
CREATE TRIGGER "audit_fallback_eventcollaborator"
  AFTER INSERT OR UPDATE OR DELETE ON "EventCollaborator"
  FOR EACH ROW EXECUTE FUNCTION "write_security_audit_fallback"();
DROP TRIGGER IF EXISTS "audit_fallback_eventcollaboratorinvite" ON "EventCollaboratorInvite";
CREATE TRIGGER "audit_fallback_eventcollaboratorinvite"
  AFTER INSERT OR UPDATE OR DELETE ON "EventCollaboratorInvite"
  FOR EACH ROW EXECUTE FUNCTION "write_security_audit_fallback"();
