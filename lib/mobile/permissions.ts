import { EventPermission } from "@prisma/client";
import { judgingPermissionsFor } from "@/lib/judgingPermissions";
import type { EventPermissionsDto } from "@/lib/mobile/schemas";

/*
 * Pure permission flags for the mobile organiser UI. The web derives its
 * controls from lib/eventDashboard/capabilities.ts; the one difference is
 * `manageRegistrations`, which this contract version keeps admin-only although
 * the shared RSVP cores also accept the MANAGE_REGISTRATIONS grant
 * (docs/PERMISSIONS.md#mobile-api).
 */

export function eventPermissionsFor(isAdmin: boolean, grant: readonly EventPermission[], options: { submissionsEnabled?: boolean } = {}): EventPermissionsDto {
  const has = (permission: EventPermission) => isAdmin || grant.includes(permission);
  return {
    checkIn: has(EventPermission.CHECK_IN),
    // Emails, feedback settings and the registration window are organisation
    // OWNER/ADMIN operations on the web, so they are here too.
    manageRegistrations: isAdmin,
    sendEmails: isAdmin,
    schedule: has(EventPermission.PUBLISH_AND_SCHEDULE),
    manageFeedback: isAdmin,
    manageRegistrationWindow: isAdmin,
    // The judging workspace (resolveJudgeContext): OWNER/ADMIN or the JUDGE grant,
    // and only once the event takes submissions.
    judge: Boolean(options.submissionsEnabled) && judgingPermissionsFor(isAdmin, false, grant).canJudge,
  };
}

/** Guests and counts are visible to registration managers and to the check-in desk (which already sees the roster). */
export function canSeeGuests(permissions: EventPermissionsDto) {
  return permissions.manageRegistrations || permissions.checkIn;
}
