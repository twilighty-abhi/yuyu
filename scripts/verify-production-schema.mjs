import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [userColumns, feedbackColumns, assetColumns, apiCredentialColumns, constraints, indexes, triggers] = await Promise.all([
    prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User'
    `,
    prisma.$queryRaw`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'EventFeedbackResponse'
    `,
    prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Asset'
    `,
    prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ApiCredential'
    `,
    prisma.$queryRaw`
      SELECT conname
      FROM pg_constraint
      WHERE conname IN ('RSVP_exactly_one_target', 'CheckInEvent_rsvpId_fkey', 'AuditEvent_organisationId_fkey', 'ApiClient_organisationId_fkey', 'AuditEvent_actorApiClientId_fkey', 'ApiCredential_secret_hash_length', 'AuditEvent_single_actor')
    `,
    prisma.$queryRaw`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN ('Asset_key_key', 'RSVP_event_attendee_unique', 'RSVP_instance_attendee_unique', 'ApiClient_organisationId_status_idx', 'ApiCredential_apiClientId_revokedAt_idx')
    `,
    prisma.$queryRaw`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE trigger_schema = 'public' AND trigger_name IN ('audit_fallback_organisation', 'audit_fallback_membership', 'audit_fallback_event', 'audit_fallback_rsvp', 'audit_fallback_apiclient', 'audit_fallback_apicredential')
    `,
  ]);
  const columnNames = new Set(assetColumns.map((row) => row.column_name));
  const userColumnNames = new Set(userColumns.map((row) => row.column_name));
  const apiCredentialColumnNames = new Set(apiCredentialColumns.map((row) => row.column_name));
  const nullableFeedbackColumns = new Set(feedbackColumns.filter((row) => row.is_nullable === "YES").map((row) => row.column_name));
  const constraintNames = new Set(constraints.map((row) => row.conname));
  const indexNames = new Set(indexes.map((row) => row.indexname));
  const triggerNames = new Set(triggers.map((row) => row.trigger_name));
  const missing = [
    ...["fileData", "key"].filter((column) => !columnNames.has(column)),
    ...["mfaSecretEncrypted", "mfaEnabledAt", "recoveryCodeHashes"].filter((column) => !userColumnNames.has(column)),
    ...["rsvpId", "certificateToken"].filter((column) => !nullableFeedbackColumns.has(column)),
    ...["secretHash", "revokedAt", "expiresAt", "lastUsedAt"].filter((column) => !apiCredentialColumnNames.has(column)),
    ...["RSVP_exactly_one_target", "CheckInEvent_rsvpId_fkey", "AuditEvent_organisationId_fkey", "ApiClient_organisationId_fkey", "AuditEvent_actorApiClientId_fkey", "ApiCredential_secret_hash_length", "AuditEvent_single_actor"].filter((name) => !constraintNames.has(name)),
    ...["Asset_key_key", "RSVP_event_attendee_unique", "RSVP_instance_attendee_unique", "ApiClient_organisationId_status_idx", "ApiCredential_apiClientId_revokedAt_idx"].filter((name) => !indexNames.has(name)),
    ...["audit_fallback_organisation", "audit_fallback_membership", "audit_fallback_event", "audit_fallback_rsvp", "audit_fallback_apiclient", "audit_fallback_apicredential"].filter((name) => !triggerNames.has(name)),
  ];
  if (missing.length > 0) {
    throw new Error(`Database schema contract failed; missing: ${missing.join(", ")}`);
  }
  console.log("Database schema contract passed.");
} finally {
  await prisma.$disconnect();
}
