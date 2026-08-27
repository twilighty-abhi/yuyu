-- A child DELETE can be part of an Organisation cascade after PostgreSQL has
-- already processed SET NULL for existing AuditEvent rows. A new fallback row
-- must therefore not reference the organisation being deleted.
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
    target_id := row_data ->> 'id';
    organisation_id := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_data ->> 'organisationId' END;
  ELSE
    target_id := row_data ->> 'apiClientId';
    IF TG_OP = 'DELETE' THEN
      organisation_id := NULL;
    ELSE
      SELECT "organisationId" INTO organisation_id
        FROM "ApiClient" WHERE "id" = target_id;
    END IF;
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
