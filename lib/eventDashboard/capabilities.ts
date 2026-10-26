import { EventPermission, type MembershipRole } from "@prisma/client";
import { judgingPermissionsFor } from "@/lib/judgingPermissions";

/*
 * The single source of truth for what the event and series dashboards show.
 * Each flag mirrors the server check of the action or route behind the
 * control (see docs/PERMISSIONS.md). The flags only decide visibility: every
 * Server Action and route handler re-checks access itself.
 *
 * Pure and dependency-free so it can be unit tested for every role and grant.
 */

export type EventCapabilities = {
  /** Organisation OWNER/ADMIN. */
  isAdmin: boolean;
  /** Guest list, approvals, manual add/edit/remove, and registration numbers (`MANAGE_REGISTRATIONS`). */
  canManageRegistrations: boolean;
  /** Attendee CSV (`/api/exports/events/:eventId/attendees`). */
  canExportAttendees: boolean;
  /** Analytics tab: registration numbers. */
  canViewAnalytics: boolean;
  /** Event and series invite lists (`MANAGE_INVITATIONS`). */
  canManageInvitations: boolean;
  /** Check-in desk, scanner, offline roster, undo check-in and badge printing (`CHECK_IN`). */
  canCheckIn: boolean;
  /** Check guests into or out of custom check-in lists (`CHECK_IN`, the same rule as entry check-in). */
  canCheckInToLists: boolean;
  /** Create, rename, reorder, archive and restore custom check-in lists (`EDIT_DETAILS`). */
  canManageCheckInLists: boolean;
  /** Venue station PIN: on, reveal, rotate, off. */
  canManageCheckInStation: boolean;
  /** Event page content: page settings, highlights, speakers, sponsors, resources, FAQs (`EDIT_DETAILS`). */
  canEditPageContent: boolean;
  /** The Details form (`updateEvent`): title, dates, venue, capacity, privacy, discovery, registration window, cover. */
  canEditEventDetails: boolean;
  /** Registration form questions. */
  canEditRegistrationForm: boolean;
  /** Programme schedule: tracks, sessions, live delays (`PUBLISH_AND_SCHEDULE`). */
  canManageSchedule: boolean;
  /** Set the event Live (`publishEvent`, `canPublishEvents`). */
  canPublish: boolean;
  /** Create or regenerate the short link. */
  canManageShortLink: boolean;
  /** Broadcast emails to guests. */
  canSendEmails: boolean;
  /** Feedback form, feedback settings and the certificate builder. */
  canManageFeedback: boolean;
  /** Feedback responses and the feedback CSV. */
  canViewFeedbackResponses: boolean;
  /** Post-event PDF reports. */
  canDownloadReports: boolean;
  /** Change the event address (`updateEventSlug`). */
  canChangeEventAddress: boolean;
  canCloneEvent: boolean;
  /** Embed snippets in Settings and the Overview shortcut to them. */
  canEmbedEvent: boolean;
  canDeleteEvent: boolean;
  /** Co-organiser invites, grants and removal. */
  canManageCollaborators: boolean;
  /** Judging workspace: org owner/admin or a `JUDGE` collaborator (docs/HACKATHON.md). */
  canJudge: boolean;
  /** Judging settings, rubric, assignments, awards, and results: org owner/admin only. */
  canManageJudging: boolean;
  /**
   * A non-member collaborator whose only grant is `JUDGE`. The page shows
   * nothing but the judging workspace: no overview data, guests, page editor,
   * emails, check-in, feedback, analytics, or settings.
   */
  isJudgeOnly: boolean;
};

export type SeriesCapabilities = {
  isAdmin: boolean;
  /** Series details form, including deleting the series (`updateEventSeriesMeta`, `deleteEventSeries`). */
  canEditSeries: boolean;
  canManageInvitations: boolean;
  canManageSchedule: boolean;
  canManageRegistrations: boolean;
  canDownloadReports: boolean;
};

function access(role: MembershipRole | null | undefined, grant: readonly EventPermission[] | null | undefined) {
  const isAdmin = role === "OWNER" || role === "ADMIN";
  const has = (permission: EventPermission) => isAdmin || Boolean(grant?.includes(permission));
  return { isAdmin, has };
}

/**
 * `role` is the viewer's organisation role (null for a collaborator who is not
 * a member); `grant` is their `EventCollaborator.permissions` for this event.
 * A grant never implies another, and organisation-level operations stay with
 * owners and admins whatever the grant.
 */
export function eventCapabilities(
  role: MembershipRole | null | undefined,
  grant: readonly EventPermission[] | null | undefined,
): EventCapabilities {
  const { isAdmin, has } = access(role, grant);
  const registrations = has(EventPermission.MANAGE_REGISTRATIONS);
  // JUDGE never satisfies `has` for any other permission (grants are exact).
  const judging = judgingPermissionsFor(isAdmin, role != null, grant ?? []);
  return {
    isAdmin,
    canManageRegistrations: registrations,
    canExportAttendees: registrations,
    canViewAnalytics: registrations,
    canManageInvitations: has(EventPermission.MANAGE_INVITATIONS),
    canCheckIn: has(EventPermission.CHECK_IN),
    canCheckInToLists: has(EventPermission.CHECK_IN),
    canManageCheckInLists: has(EventPermission.EDIT_DETAILS),
    canManageCheckInStation: isAdmin,
    canEditPageContent: has(EventPermission.EDIT_DETAILS),
    canEditEventDetails: isAdmin,
    canEditRegistrationForm: isAdmin,
    canManageSchedule: has(EventPermission.PUBLISH_AND_SCHEDULE),
    canPublish: isAdmin,
    canManageShortLink: isAdmin,
    canSendEmails: isAdmin,
    canManageFeedback: isAdmin,
    canViewFeedbackResponses: isAdmin,
    canDownloadReports: isAdmin,
    canChangeEventAddress: isAdmin,
    canCloneEvent: isAdmin,
    canEmbedEvent: isAdmin,
    canDeleteEvent: isAdmin,
    canManageCollaborators: isAdmin,
    canJudge: judging.canJudge,
    canManageJudging: judging.canManageJudging,
    isJudgeOnly: judging.isJudgeOnly,
  };
}

/** The same rules for a recurring series, where `grant` is the series-level collaborator grant. */
export function seriesCapabilities(
  role: MembershipRole | null | undefined,
  grant: readonly EventPermission[] | null | undefined,
): SeriesCapabilities {
  const { isAdmin, has } = access(role, grant);
  return {
    isAdmin,
    canEditSeries: isAdmin,
    canManageInvitations: has(EventPermission.MANAGE_INVITATIONS),
    canManageSchedule: has(EventPermission.PUBLISH_AND_SCHEDULE),
    canManageRegistrations: has(EventPermission.MANAGE_REGISTRATIONS),
    canDownloadReports: isAdmin,
  };
}
