import { EventPermission, type MembershipRole } from "@prisma/client";

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
  return {
    isAdmin,
    canManageRegistrations: registrations,
    canExportAttendees: registrations,
    canViewAnalytics: registrations,
    canManageInvitations: has(EventPermission.MANAGE_INVITATIONS),
    canCheckIn: has(EventPermission.CHECK_IN),
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
