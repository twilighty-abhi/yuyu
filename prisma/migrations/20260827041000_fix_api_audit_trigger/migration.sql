-- PL/pgSQL can plan boolean expressions without guaranteeing source-order
-- short-circuiting. Keep credential-only NEW/OLD fields in a nested branch so
-- the trigger is also valid for ApiClient and ApiClientScope records.
CREATE OR REPLACE FUNCTION "write_api_security_audit_fallback"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  row_data jsonb;
  organisation_id text;
  target_id text;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  IF TG_TABLE_NAME = 'ApiCredential' AND TG_OP = 'UPDATE' THEN
    IF NEW."apiClientId" = OLD."apiClientId"
       AND NEW."name" = OLD."name"
       AND NEW."secretHash" = OLD."secretHash"
       AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt"
       AND NEW."revokedAt" IS NOT DISTINCT FROM OLD."revokedAt" THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'ApiClient' THEN
    organisation_id := row_data ->> 'organisationId';
    target_id := row_data ->> 'id';
  ELSE
    target_id := row_data ->> 'apiClientId';
    SELECT "organisationId" INTO organisation_id
      FROM "ApiClient" WHERE "id" = target_id;
  END IF;

  INSERT INTO "AuditEvent" (
    "id", "action", "organisationId", "targetType", "targetId", "metadata", "createdAt"
  ) VALUES (
    gen_random_uuid()::text,
    'DB_' || upper(TG_TABLE_NAME) || '_' || TG_OP,
    organisation_id,
    TG_TABLE_NAME,
    target_id,
    jsonb_build_object('source', 'database-trigger'),
    CURRENT_TIMESTAMP
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
