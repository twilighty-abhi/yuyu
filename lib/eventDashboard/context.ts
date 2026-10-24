import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { EventPermission, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { isOrgAdmin, requireOrgDashboardAccess } from "@/lib/permissions";
import { canViewEventDashboard } from "@/lib/eventAccess";
import { judgingPermissionsFor } from "@/lib/judgingPermissions";

/*
 * Shared context for the event dashboard (app/dashboard/[orgSlug]/event/[eventId]).
 * Access is resolved once here; every tab panel receives the result and must
 * respect `permissions` before loading or showing anything sensitive.
 */

export const eventDashboardInclude = {
  page: { include: { sections: { orderBy: { sortOrder: "asc" } } } },
  highlights: { orderBy: { sortOrder: "asc" } },
  speakers: { orderBy: { sortOrder: "asc" } },
  sponsors: { orderBy: { sortOrder: "asc" } },
  resources: { orderBy: { sortOrder: "asc" } },
  faqs: { orderBy: { sortOrder: "asc" } },
  sessions: { orderBy: { sortOrder: "asc" }, include: { speakers: true } },
} satisfies Prisma.EventInclude;

export type DashboardEvent = Prisma.EventGetPayload<{ include: typeof eventDashboardInclude }>;

export type EventDashboardPermissions = {
  /** Organisation OWNER/ADMIN. */
  isAdmin: boolean;
  /** RSVP lifecycle actions are organisation-admin operations (matches the server actions). */
  canManageRegistrations: boolean;
  canManageInvitations: boolean;
  canCheckIn: boolean;
  canEditDetails: boolean;
  canManageSchedule: boolean;
  canManageCollaborators: boolean;
  /** Judging workspace: org owner/admin or a JUDGE collaborator (docs/HACKATHON.md). */
  canJudge: boolean;
  /** Judging settings, rubric, assignments, awards, and results: org owner/admin only. */
  canManageJudging: boolean;
  /**
   * A collaborator whose only grant is JUDGE. The page must show nothing but
   * the judging workspace: no overview data, guests, page editor, emails,
   * check-in, feedback, analytics, or settings.
   */
  isJudgeOnly: boolean;
};

export type EventDashboardContext = {
  organisation: { id: string; slug: string; name: string };
  event: DashboardEvent;
  userId: string;
  origin: string;
  now: Date;
  permissions: EventDashboardPermissions;
};

/** Resolves access and loads the event once per request (cached across panels). */
export const loadEventDashboard = cache(async (orgSlug: string, eventId: string): Promise<EventDashboardContext> => {
  const access = await requireOrgDashboardAccess(orgSlug);
  const { organisation } = access;

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: organisation.id },
    include: eventDashboardInclude,
  });
  if (!event) notFound();
  if (!access.membership && !(await canViewEventDashboard({ userId: access.userId, organisationId: organisation.id, eventId: event.id }))) notFound();

  const isAdmin = Boolean(access.membership && isOrgAdmin(access.membership.role));
  const grant = isAdmin
    ? null
    : await prisma.eventCollaborator.findFirst({ where: { eventId: event.id, userId: access.userId }, select: { permissions: true } });
  const has = (permission: EventPermission) => isAdmin || Boolean(grant?.permissions.includes(permission));
  const judging = judgingPermissionsFor(isAdmin, Boolean(access.membership), grant?.permissions ?? []);

  return {
    organisation: { id: organisation.id, slug: organisation.slug, name: organisation.name },
    event,
    userId: access.userId,
    origin: await getRequestOrigin(),
    now: new Date(),
    permissions: {
      isAdmin,
      canManageRegistrations: isAdmin,
      canManageInvitations: has(EventPermission.MANAGE_INVITATIONS),
      canCheckIn: has(EventPermission.CHECK_IN),
      canEditDetails: isAdmin,
      canManageSchedule: has(EventPermission.PUBLISH_AND_SCHEDULE),
      canManageCollaborators: isAdmin,
      canJudge: judging.canJudge,
      canManageJudging: judging.canManageJudging,
      isJudgeOnly: judging.isJudgeOnly,
    },
  };
});
