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
  organisation_id := CASE TG_TABLE_NAME
    WHEN 'Organisation' THEN CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE target_id END
    WHEN 'Membership' THEN row_data ->> 'organisationId'
    WHEN 'Event' THEN row_data ->> 'organisationId'
    WHEN 'EventSeries' THEN row_data ->> 'organisationId'
    WHEN 'OrganisationInvite' THEN row_data ->> 'organisationId'
    ELSE NULL
  END;
  IF TG_TABLE_NAME = 'EventInvite' THEN
    SELECT "organisationId" INTO organisation_id FROM "Event" WHERE "id" = row_data ->> 'eventId';
  ELSIF TG_TABLE_NAME = 'SeriesInvite' THEN
    SELECT "organisationId" INTO organisation_id FROM "EventSeries" WHERE "id" = row_data ->> 'eventSeriesId';
  ELSIF TG_TABLE_NAME = 'RSVP' THEN
    IF row_data ->> 'eventId' IS NOT NULL THEN
      SELECT "organisationId" INTO organisation_id FROM "Event" WHERE "id" = row_data ->> 'eventId';
    ELSE
      SELECT s."organisationId" INTO organisation_id FROM "EventInstance" i INNER JOIN "EventSeries" s ON s."id" = i."eventSeriesId" WHERE i."id" = row_data ->> 'eventInstanceId';
    END IF;
  END IF;
  INSERT INTO "AuditEvent" ("id", "action", "organisationId", "targetType", "targetId", "metadata", "createdAt")
  VALUES (gen_random_uuid()::text, 'DB_' || upper(TG_TABLE_NAME) || '_' || TG_OP, organisation_id, TG_TABLE_NAME, target_id, jsonb_build_object('source', 'database-trigger'), CURRENT_TIMESTAMP);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Organisation', 'Membership', 'Event', 'EventSeries', 'OrganisationInvite', 'EventInvite', 'SeriesInvite', 'RSVP'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'audit_fallback_' || lower(table_name), table_name);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "write_security_audit_fallback"()', 'audit_fallback_' || lower(table_name), table_name);
  END LOOP;
END;
$$;
