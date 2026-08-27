CREATE TYPE "ApiClientStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "ApiClient" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ApiClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiClientScope" (
  "apiClientId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiClientScope_pkey" PRIMARY KEY ("apiClientId", "scope")
);

CREATE TABLE "ApiCredential" (
  "id" TEXT NOT NULL,
  "apiClientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "secretHash" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuditEvent" ADD COLUMN "actorApiClientId" TEXT;

ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_secret_hash_length"
  CHECK (octet_length("secretHash") = 32);
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_single_actor"
  CHECK ("actorUserId" IS NULL OR "actorApiClientId" IS NULL);

CREATE INDEX "ApiClient_organisationId_status_idx" ON "ApiClient"("organisationId", "status");
CREATE INDEX "ApiClientScope_scope_idx" ON "ApiClientScope"("scope");
CREATE INDEX "ApiCredential_apiClientId_revokedAt_idx" ON "ApiCredential"("apiClientId", "revokedAt");
CREATE INDEX "ApiCredential_expiresAt_idx" ON "ApiCredential"("expiresAt");
CREATE INDEX "AuditEvent_actorApiClientId_createdAt_idx" ON "AuditEvent"("actorApiClientId", "createdAt");

ALTER TABLE "ApiClient" ADD CONSTRAINT "ApiClient_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiClientScope" ADD CONSTRAINT "ApiClientScope_apiClientId_fkey"
  FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_apiClientId_fkey"
  FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorApiClientId_fkey"
  FOREIGN KEY ("actorApiClientId") REFERENCES "ApiClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Database-side fallback auditing for mutations that bypass application code.
-- Routine last-used timestamps are deliberately excluded to avoid noisy audit data.
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

  IF TG_TABLE_NAME = 'ApiCredential' AND TG_OP = 'UPDATE'
     AND NEW."apiClientId" = OLD."apiClientId"
     AND NEW."name" = OLD."name"
     AND NEW."secretHash" = OLD."secretHash"
     AND NEW."expiresAt" IS NOT DISTINCT FROM OLD."expiresAt"
     AND NEW."revokedAt" IS NOT DISTINCT FROM OLD."revokedAt" THEN
    RETURN NEW;
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

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "audit_fallback_apiclient"
  AFTER INSERT OR UPDATE OR DELETE ON "ApiClient"
  FOR EACH ROW EXECUTE FUNCTION "write_api_security_audit_fallback"();
CREATE TRIGGER "audit_fallback_apiclientscope"
  AFTER INSERT OR UPDATE OR DELETE ON "ApiClientScope"
  FOR EACH ROW EXECUTE FUNCTION "write_api_security_audit_fallback"();
CREATE TRIGGER "audit_fallback_apicredential"
  AFTER INSERT OR UPDATE OR DELETE ON "ApiCredential"
  FOR EACH ROW EXECUTE FUNCTION "write_api_security_audit_fallback"();
