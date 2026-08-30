import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [feedbackAnswerColumns, userColumns, feedbackColumns, assetColumns, apiCredentialColumns, featureTables, eventColumns, eventPageColumns, eventSessionColumns, constraints, indexes, triggers] = await Promise.all([
    prisma.$queryRaw`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'EventFeedbackAnswer'
    `,
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
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN (
        'EventCollaborator', 'EventCollaboratorInvite', 'EventScheduleItem',
        'EventPage', 'EventPageSection', 'EventHighlight', 'EventVenue',
        'EventVenueRoom', 'EventSession', 'EventSpeaker',
        'EventSessionSpeaker', 'EventSponsor', 'EventFaq', 'EventResource'
      )
    `,
    prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Event'
    `,
    prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'EventPage'
    `,
    prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'EventSession'
    `,
    prisma.$queryRaw`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE conname IN (
        'RSVP_exactly_one_target', 'CheckInEvent_rsvpId_fkey',
        'AuditEvent_organisationId_fkey', 'ApiClient_organisationId_fkey',
        'AuditEvent_actorApiClientId_fkey', 'ApiCredential_secret_hash_length',
        'AuditEvent_single_actor', 'Event_registration_cutoff_mode',
        'EventCollaborator_one_target', 'EventCollaboratorInvite_one_target',
        'EventResource_one_parent', 'EventResource_one_source',
        'Event_valid_time_range', 'Event_positive_capacity',
        'EventSeries_positive_duration', 'EventInstance_valid_time_range',
        'EventSession_valid_time_range', 'OrganisationInvite_usage_pair',
        'EventCollaboratorInvite_usage_pair', 'CheckInEvent_known_action',
        'CheckInEvent_known_source', 'EventFeedbackAnswer_fieldId_fkey',
        'EventFeedbackResponse_identity_capability_pair',
        'EventFeedbackAnswer_typed_value', 'OutboxMessage_attempts_nonnegative',
        'OutboxMessage_state_shape'
      )
    `,
    prisma.$queryRaw`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN ('Asset_key_key', 'RSVP_event_attendee_unique', 'RSVP_instance_attendee_unique', 'ApiClient_organisationId_status_idx', 'ApiCredential_apiClientId_revokedAt_idx')
    `,
    prisma.$queryRaw`
      SELECT trigger_name
      FROM information_schema.triggers
      WHERE trigger_schema = 'public' AND trigger_name IN (
        'audit_fallback_organisation', 'audit_fallback_membership',
        'audit_fallback_event', 'audit_fallback_eventseries',
        'audit_fallback_organisationinvite', 'audit_fallback_eventinvite',
        'audit_fallback_seriesinvite', 'audit_fallback_rsvp',
        'audit_fallback_eventcollaborator',
        'audit_fallback_eventcollaboratorinvite', 'audit_fallback_apiclient',
        'audit_fallback_apiclientscope', 'audit_fallback_apicredential'
      )
    `,
  ]);
  const columnNames = new Set(assetColumns.map((row) => row.column_name));
  const userColumnNames = new Set(userColumns.map((row) => row.column_name));
  const apiCredentialColumnNames = new Set(apiCredentialColumns.map((row) => row.column_name));
  const featureTableNames = new Set(featureTables.map((row) => row.table_name));
  const eventColumnNames = new Set(eventColumns.map((row) => row.column_name));
  const eventPageColumnNames = new Set(eventPageColumns.map((row) => row.column_name));
  const eventSessionColumnNames = new Set(eventSessionColumns.map((row) => row.column_name));
  const nullableFeedbackColumns = new Set(feedbackColumns.filter((row) => row.is_nullable === "YES").map((row) => row.column_name));
  const feedbackAnswerColumnNames = new Set(feedbackAnswerColumns.map((row) => row.column_name));
  const nullableFeedbackAnswerColumns = new Set(feedbackAnswerColumns.filter((row) => row.is_nullable === "YES").map((row) => row.column_name));
  const constraintNames = new Set(constraints.map((row) => row.conname));
  const indexNames = new Set(indexes.map((row) => row.indexname));
  const triggerNames = new Set(triggers.map((row) => row.trigger_name));
  const missing = [
    ...["fileData", "key"].filter((column) => !columnNames.has(column)),
    ...["mfaSecretEncrypted", "mfaEnabledAt", "recoveryCodeHashes"].filter((column) => !userColumnNames.has(column)),
    ...["rsvpId", "certificateToken"].filter((column) => !nullableFeedbackColumns.has(column)),
    ...["fieldKey", "fieldLabel", "fieldType"].filter((column) => !feedbackAnswerColumnNames.has(column)),
    ...["fieldId"].filter((column) => !nullableFeedbackAnswerColumns.has(column)),
    ...["secretHash", "revokedAt", "expiresAt", "lastUsedAt"].filter((column) => !apiCredentialColumnNames.has(column)),
    ...["EventCollaborator", "EventCollaboratorInvite", "EventScheduleItem", "EventPage", "EventPageSection", "EventHighlight", "EventVenue", "EventVenueRoom", "EventSession", "EventSpeaker", "EventSessionSpeaker", "EventSponsor", "EventFaq", "EventResource"].filter((table) => !featureTableNames.has(table)),
    ...["registrationClosesAt", "registrationLeadMinutes", "checkInStationPinHash", "checkInStationPinEncrypted", "checkInStationSecretVersion"].filter((column) => !eventColumnNames.has(column)),
    ...["isPublished"].filter((column) => !eventPageColumnNames.has(column)),
    ...["delayMinutes"].filter((column) => !eventSessionColumnNames.has(column)),
    ...["RSVP_exactly_one_target", "CheckInEvent_rsvpId_fkey", "AuditEvent_organisationId_fkey", "ApiClient_organisationId_fkey", "AuditEvent_actorApiClientId_fkey", "ApiCredential_secret_hash_length", "AuditEvent_single_actor", "Event_registration_cutoff_mode", "EventCollaborator_one_target", "EventCollaboratorInvite_one_target", "EventResource_one_parent", "EventResource_one_source", "Event_valid_time_range", "Event_positive_capacity", "EventSeries_positive_duration", "EventInstance_valid_time_range", "EventSession_valid_time_range", "OrganisationInvite_usage_pair", "EventCollaboratorInvite_usage_pair", "CheckInEvent_known_action", "CheckInEvent_known_source", "EventFeedbackAnswer_fieldId_fkey", "EventFeedbackResponse_identity_capability_pair", "EventFeedbackAnswer_typed_value", "OutboxMessage_attempts_nonnegative", "OutboxMessage_state_shape"].filter((name) => !constraintNames.has(name)),
    ...(constraints.some((row) => row.conname === "EventFeedbackAnswer_fieldId_fkey" && row.confdeltype === "n") ? [] : ["EventFeedbackAnswer_fieldId_fkey:ON DELETE SET NULL"]),
    ...["Asset_key_key", "RSVP_event_attendee_unique", "RSVP_instance_attendee_unique", "ApiClient_organisationId_status_idx", "ApiCredential_apiClientId_revokedAt_idx"].filter((name) => !indexNames.has(name)),
    ...["audit_fallback_organisation", "audit_fallback_membership", "audit_fallback_event", "audit_fallback_eventseries", "audit_fallback_organisationinvite", "audit_fallback_eventinvite", "audit_fallback_seriesinvite", "audit_fallback_rsvp", "audit_fallback_eventcollaborator", "audit_fallback_eventcollaboratorinvite", "audit_fallback_apiclient", "audit_fallback_apiclientscope", "audit_fallback_apicredential"].filter((name) => !triggerNames.has(name)),
  ];
  if (missing.length > 0) {
    throw new Error(`Database schema contract failed; missing: ${missing.join(", ")}`);
  }
  console.log("Database schema contract passed.");
} finally {
  await prisma.$disconnect();
}
