import { EventPermission, MembershipRole } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { eventCapabilities, seriesCapabilities, type EventCapabilities, type SeriesCapabilities } from "@/lib/eventDashboard/capabilities";

/*
 * The permission matrix from docs/PERMISSIONS.md, written out by hand so a
 * change to lib/eventDashboard/capabilities.ts must also change this table.
 * `grant` names the single EventPermission that unlocks a flag for someone
 * who is not an organisation owner/admin; `null` means owners/admins only.
 */
const EVENT_MATRIX: Record<keyof EventCapabilities, EventPermission | null> = {
  isAdmin: null,
  canManageRegistrations: EventPermission.MANAGE_REGISTRATIONS,
  canExportAttendees: EventPermission.MANAGE_REGISTRATIONS,
  canViewAnalytics: EventPermission.MANAGE_REGISTRATIONS,
  canManageInvitations: EventPermission.MANAGE_INVITATIONS,
  canCheckIn: EventPermission.CHECK_IN,
  canCheckInToLists: EventPermission.CHECK_IN,
  canManageCheckInLists: EventPermission.EDIT_DETAILS,
  canManageCheckInStation: null,
  canEditPageContent: EventPermission.EDIT_DETAILS,
  canEditEventDetails: null,
  canEditRegistrationForm: null,
  canManageSchedule: EventPermission.PUBLISH_AND_SCHEDULE,
  canPublish: null,
  canManageShortLink: null,
  canSendEmails: null,
  canManageFeedback: null,
  canViewFeedbackResponses: null,
  canDownloadReports: null,
  canChangeEventAddress: null,
  canCloneEvent: null,
  canEmbedEvent: null,
  canDeleteEvent: null,
  canManageCollaborators: null,
};

const SERIES_MATRIX: Record<keyof SeriesCapabilities, EventPermission | null> = {
  isAdmin: null,
  canEditSeries: null,
  canManageInvitations: EventPermission.MANAGE_INVITATIONS,
  canManageSchedule: EventPermission.PUBLISH_AND_SCHEDULE,
  canManageRegistrations: EventPermission.MANAGE_REGISTRATIONS,
  canDownloadReports: null,
};

const ALL = Object.values(EventPermission);
const GRANTS: Array<[string, EventPermission[]]> = [
  ["no grant", []],
  ...ALL.map((permission): [string, EventPermission[]] => [permission, [permission]]),
  ["every grant", ALL],
];
const ROLES: Array<MembershipRole | null> = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER, null];

function expected<K extends string>(matrix: Record<K, EventPermission | null>, role: MembershipRole | null, grant: EventPermission[]) {
  const admin = role === MembershipRole.OWNER || role === MembershipRole.ADMIN;
  return Object.fromEntries(
    (Object.keys(matrix) as K[]).map((key) => [key, admin || (matrix[key] !== null && grant.includes(matrix[key]!))]),
  ) as Record<K, boolean>;
}

const cases = ROLES.flatMap((role) => GRANTS.map(([name, grant]) => [role ?? "non-member", name, role, grant] as const));

describe("eventCapabilities", () => {
  it("covers every flag in the matrix", () => {
    expect(Object.keys(eventCapabilities(null, [])).sort()).toEqual(Object.keys(EVENT_MATRIX).sort());
  });

  it.each(cases)("%s with %s", (_role, _grant, role, grant) => {
    expect(eventCapabilities(role, grant)).toEqual(expected(EVENT_MATRIX, role, grant));
  });

  it("never lets a co-organiser with every grant delete, clone, embed, publish or manage collaborators", () => {
    for (const role of [null, MembershipRole.MEMBER]) {
      const can = eventCapabilities(role, ALL);
      expect(can).toMatchObject({
        isAdmin: false,
        canDeleteEvent: false,
        canCloneEvent: false,
        canEmbedEvent: false,
        canChangeEventAddress: false,
        canPublish: false,
        canManageShortLink: false,
        canManageCollaborators: false,
        canManageCheckInStation: false,
        canSendEmails: false,
        canManageFeedback: false,
        canDownloadReports: false,
      });
      // ...but they reach the control for each grant they hold.
      expect(can).toMatchObject({
        canEditPageContent: true,
        canManageRegistrations: true,
        canExportAttendees: true,
        canManageInvitations: true,
        canCheckIn: true,
        canManageSchedule: true,
      });
    }
  });

  it("lets CHECK_IN scan into lists but only EDIT_DETAILS (or admins) manage them", () => {
    expect(eventCapabilities(null, [EventPermission.CHECK_IN])).toMatchObject({ canCheckInToLists: true, canManageCheckInLists: false });
    expect(eventCapabilities(null, [EventPermission.EDIT_DETAILS])).toMatchObject({ canCheckInToLists: false, canManageCheckInLists: true });
    expect(eventCapabilities(MembershipRole.MEMBER, [])).toMatchObject({ canCheckInToLists: false, canManageCheckInLists: false });
    expect(eventCapabilities(MembershipRole.ADMIN, [])).toMatchObject({ canCheckInToLists: true, canManageCheckInLists: true });
  });

  it("treats a missing grant like an empty one", () => {
    expect(eventCapabilities(null, null)).toEqual(eventCapabilities(null, []));
    expect(eventCapabilities(undefined, undefined)).toEqual(eventCapabilities(null, []));
    expect(Object.values(eventCapabilities(null, [])).every((value) => value === false)).toBe(true);
  });
});

describe("seriesCapabilities", () => {
  it("covers every flag in the matrix", () => {
    expect(Object.keys(seriesCapabilities(null, [])).sort()).toEqual(Object.keys(SERIES_MATRIX).sort());
  });

  it.each(cases)("%s with %s", (_role, _grant, role, grant) => {
    expect(seriesCapabilities(role, grant)).toEqual(expected(SERIES_MATRIX, role, grant));
  });
});
