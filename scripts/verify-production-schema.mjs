import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [certificateFormColumns, feedbackAnswerColumns, userColumns, feedbackColumns, assetColumns, apiCredentialColumns, featureTables, eventColumns, eventPageColumns, eventSessionColumns, instanceSettingColumns, constraints, indexes, triggers] = await Promise.all([
    prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'EventFeedbackForm'`,
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
        'EventSessionSpeaker', 'EventSponsor', 'EventFaq', 'EventResource',
        'EventBroadcast', 'Team', 'TeamSeekerProfile', 'TeamJoinRequest',
        'Submission', 'SubmissionLink', 'JudgingCriterion', 'JudgeAssignment',
        'JudgeScore', 'JudgeReview', 'EventAward', 'EventAwardWinner',
        'CheckInList', 'CheckInListRecord', 'CheckInListEvent', 'SavedView',
        'AttendanceCheck', 'EventCrewMember', 'EventCrewJoinLink'
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
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'InstanceSetting'
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
        'OutboxMessage_state_shape', 'Event_team_min_size_positive',
        'Event_team_max_size_at_least_two', 'Event_team_size_order',
        'Event_team_mode_requires_max_size', 'TeamSeekerProfile_skills_limit',
        'RSVP_teamId_fkey', 'Team_eventId_fkey', 'Team_leaderRsvpId_fkey',
        'RSVP_crew_shape', 'EventCrewMember_rsvpId_fkey',
        'Submission_exactly_one_entrant', 'Submission_links_https',
        'Event_submission_window_order', 'SubmissionLink_token_hash_shape',
        'JudgingCriterion_weight_range', 'JudgingCriterion_max_score_range',
        'JudgeScore_score_range', 'EventAwardWinner_place_positive',
        'Event_reviews_per_project_range',
        'Submission_teamId_fkey', 'Submission_rsvpId_fkey',
        'CheckInListRecord_known_source', 'CheckInListEvent_known_action',
        'CheckInListEvent_known_source', 'SavedView_name_length',
        'SavedView_params_object', 'SavedView_eventId_fkey',
        'AttendanceCheck_token_hash_shape', 'AttendanceCheck_note_length',
        'AttendanceCheck_response_pair', 'AttendanceCheck_rsvpId_fkey',
        'AttendanceCheck_eventId_fkey'
      )
    `,
    prisma.$queryRaw`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND indexname IN ('Asset_key_key', 'RSVP_event_attendee_unique', 'RSVP_instance_attendee_unique', 'ApiClient_organisationId_status_idx', 'ApiCredential_apiClientId_revokedAt_idx', 'Team_eventId_nameKey_key', 'Team_joinToken_key', 'Team_manageTokenHash_key', 'TeamJoinRequest_one_pending_per_team_rsvp', 'Submission_teamId_key', 'Submission_rsvpId_key', 'SubmissionLink_tokenHash_key', 'JudgeScore_submissionId_judgeUserId_criterionId_key', 'JudgeReview_submissionId_judgeUserId_key', 'JudgeAssignment_judgeUserId_submissionId_key', 'EventAwardWinner_awardId_place_key', 'EventAwardWinner_awardId_submissionId_key', 'CheckInList_eventId_active_name_key', 'CheckInListRecord_listId_rsvpId_key', 'SavedView_eventId_surface_idx', 'RSVP_eventId_createdAt_id_idx', 'RSVP_eventId_checkedInAt_id_idx', 'Team_eventId_createdAt_id_idx', 'Submission_eventId_createdAt_id_idx', 'Submission_eventId_status_submittedAt_id_idx', 'EventInvite_eventId_createdAt_id_idx', 'AttendanceCheck_rsvpId_key', 'AttendanceCheck_tokenHash_key', 'AttendanceCheck_eventId_response_idx')
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
  const instanceSettingColumnNames = new Set(instanceSettingColumns.map((row) => row.column_name));
  const constraintNames = new Set(constraints.map((row) => row.conname));
  const indexNames = new Set(indexes.map((row) => row.indexname));
  const triggerNames = new Set(triggers.map((row) => row.trigger_name));
  const missing = [
    ...(certificateFormColumns.some((row) => row.column_name === "certificateTemplate") ? [] : ["EventFeedbackForm.certificateTemplate"]),
    ...["fileData", "key"].filter((column) => !columnNames.has(column)),
    ...["mfaSecretEncrypted", "mfaEnabledAt", "recoveryCodeHashes"].filter((column) => !userColumnNames.has(column)),
    ...["rsvpId", "certificateToken", "certificateTemplate"].filter((column) => !nullableFeedbackColumns.has(column)),
    ...["fieldKey", "fieldLabel", "fieldType"].filter((column) => !feedbackAnswerColumnNames.has(column)),
    ...["fieldId"].filter((column) => !nullableFeedbackAnswerColumns.has(column)),
    ...["secretHash", "revokedAt", "expiresAt", "lastUsedAt"].filter((column) => !apiCredentialColumnNames.has(column)),
    ...["EventCollaborator", "EventCollaboratorInvite", "EventScheduleItem", "EventPage", "EventPageSection", "EventHighlight", "EventVenue", "EventVenueRoom", "EventSession", "EventSpeaker", "EventSessionSpeaker", "EventSponsor", "EventFaq", "EventResource", "Team", "TeamSeekerProfile", "TeamJoinRequest", "Submission", "SubmissionLink", "JudgingCriterion", "JudgeAssignment", "JudgeScore", "JudgeReview", "EventAward", "EventAwardWinner", "CheckInList", "CheckInListRecord", "CheckInListEvent", "SavedView", "AttendanceCheck""SavedView", "AttendanceCheck", "EventCrewMember", "EventCrewJoinLink"].filter((table) => !featureTableNames.has(table))((table) => !featureTableNames.has(table)),
    ...["registrationClosesAt", "registrationLeadMinutes", "checkInStationPinHash", "checkInStationPinEncrypted", "checkInStationSecretVersion", "registrationMode", "teamMinSize", "teamMaxSize", "soloPolicy", "submissionsEnabled", "submissionsOpenAt", "submissionsCloseAt", "judgingStatus", "judgesSeeAll", "projectGalleryPublic", "resultsPublishedAt", "resultsAnnouncedAt", "reviewsPerProject", "scoreNormalization", "attendanceCheckReleaseOnDecline"].filter((column) => !eventColumnNames.has(column)),
    ...["isPublished"].filter((column) => !eventPageColumnNames.has(column)),
    ...["delayMinutes"].filter((column) => !eventSessionColumnNames.has(column)),
    ...["smtpPasswordEncrypted", "googleClientSecretEncrypted", "opsWebhookUrlEncrypted", "opsWebhookEnabled", "opsWebhookIncludeWarnings"].filter((column) => !instanceSettingColumnNames.has(column)).map((column) => `InstanceSetting.${column}`),
    ...["RSVP_exactly_one_target", "CheckInEvent_rsvpId_fkey", "AuditEvent_organisationId_fkey", "ApiClient_organisationId_fkey", "AuditEvent_actorApiClientId_fkey", "ApiCredential_secret_hash_length", "AuditEvent_single_actor", "Event_registration_cutoff_mode", "EventCollaborator_one_target", "EventCollaboratorInvite_one_target", "EventResource_one_parent", "EventResource_one_source", "Event_valid_time_range", "Event_positive_capacity", "EventSeries_positive_duration", "EventInstance_valid_time_range", "EventSession_valid_time_range", "OrganisationInvite_usage_pair", "EventCollaboratorInvite_usage_pair", "CheckInEvent_known_action", "CheckInEvent_known_source", "EventFeedbackAnswer_fieldId_fkey", "EventFeedbackResponse_identity_capability_pair", "EventFeedbackAnswer_typed_value", "OutboxMessage_attempts_nonnegative", "OutboxMessage_state_shape", "Event_team_min_size_positive", "Event_team_max_size_at_least_two", "Event_team_size_order", "Event_team_mode_requires_max_size", "TeamSeekerProfile_skills_limit", "RSVP_teamId_fkey", "Team_eventId_fkey", "Team_leaderRsvpId_fkey", "Submission_exactly_one_entrant", "Submission_links_https", "Event_submission_window_order", "SubmissionLink_token_hash_shape", "JudgingCriterion_weight_range", "JudgingCriterion_max_score_range", "JudgeScore_score_range", "EventAwardWinner_place_positive", "Event_reviews_per_project_range", "Submission_teamId_fkey", "Submission_rsvpId_fkey", "CheckInListRecord_known_source", "CheckInListEvent_known_action", "CheckInListEvent_known_source", "SavedView_name_length", "SavedView_params_object", "SavedView_eventId_fkey", "AttendanceCheck_token_hash_shape", "AttendanceCheck_note_length", "AttendanceCheck_response_pair", "AttendanceCheck_rsvpId_fkey", "AttendanceCheck_eventId_fkey", "RSVP_crew_shape", "EventCrewMember_rsvpId_fkey"].filter((name) => !constraintNames.has(name)),
    ...(constraints.some((row) => row.conname === "EventCrewMember_rsvpId_fkey" && row.confdeltype === "c") ? [] : ["EventCrewMember_rsvpId_fkey:ON DELETE CASCADE"]),
    ...(constraints.some((row) => row.conname === "SavedView_eventId_fkey" && row.confdeltype === "c") ? [] : ["SavedView_eventId_fkey:ON DELETE CASCADE"]),
    ...(constraints.some((row) => row.conname === "AttendanceCheck_rsvpId_fkey" && row.confdeltype === "c") ? [] : ["AttendanceCheck_rsvpId_fkey:ON DELETE CASCADE"]),
    ...(constraints.some((row) => row.conname === "AttendanceCheck_eventId_fkey" && row.confdeltype === "c") ? [] : ["AttendanceCheck_eventId_fkey:ON DELETE CASCADE"]),
    ...(constraints.some((row) => row.conname === "RSVP_teamId_fkey" && row.confdeltype === "n") ? [] : ["RSVP_teamId_fkey:ON DELETE SET NULL"]),
    ...(constraints.some((row) => row.conname === "Submission_teamId_fkey" && row.confdeltype === "c") ? [] : ["Submission_teamId_fkey:ON DELETE CASCADE"]),
    ...(constraints.some((row) => row.conname === "Submission_rsvpId_fkey" && row.confdeltype === "c") ? [] : ["Submission_rsvpId_fkey:ON DELETE CASCADE"]),
    ...(constraints.some((row) => row.conname === "EventFeedbackAnswer_fieldId_fkey" && row.confdeltype === "n") ? [] : ["EventFeedbackAnswer_fieldId_fkey:ON DELETE SET NULL"]),
    ...["Asset_key_key", "RSVP_event_attendee_unique", "RSVP_instance_attendee_unique", "ApiClient_organisationId_status_idx", "ApiCredential_apiClientId_revokedAt_idx", "Team_eventId_nameKey_key", "Team_joinToken_key", "Team_manageTokenHash_key", "TeamJoinRequest_one_pending_per_team_rsvp", "Submission_teamId_key", "Submission_rsvpId_key", "SubmissionLink_tokenHash_key", "JudgeScore_submissionId_judgeUserId_criterionId_key", "JudgeReview_submissionId_judgeUserId_key", "JudgeAssignment_judgeUserId_submissionId_key", "EventAwardWinner_awardId_place_key", "EventAwardWinner_awardId_submissionId_key", "CheckInList_eventId_active_name_key", "CheckInListRecord_listId_rsvpId_key", "SavedView_eventId_surface_idx", "RSVP_eventId_createdAt_id_idx", "RSVP_eventId_checkedInAt_id_idx", "Team_eventId_createdAt_id_idx", "Submission_eventId_createdAt_id_idx", "Submission_eventId_status_submittedAt_id_idx", "EventInvite_eventId_createdAt_id_idx", "AttendanceCheck_rsvpId_key", "AttendanceCheck_tokenHash_key", "AttendanceCheck_eventId_response_idx"].filter((name) => !indexNames.has(name)),
    ...["audit_fallback_organisation", "audit_fallback_membership", "audit_fallback_event", "audit_fallback_eventseries", "audit_fallback_organisationinvite", "audit_fallback_eventinvite", "audit_fallback_seriesinvite", "audit_fallback_rsvp", "audit_fallback_eventcollaborator", "audit_fallback_eventcollaboratorinvite", "audit_fallback_apiclient", "audit_fallback_apiclientscope", "audit_fallback_apicredential"].filter((name) => !triggerNames.has(name)),
  ];
  if (missing.length > 0) {
    throw new Error(`Database schema contract failed; missing: ${missing.join(", ")}`);
  }
  console.log("Database schema contract passed.");
} finally {
  await prisma.$disconnect();
}
