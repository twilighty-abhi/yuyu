import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getRequestOrigin } from "@/lib/publicUrl";
import { isOrgAdmin, requireOrgDashboardAccess } from "@/lib/permissions";
import { canViewEventDashboard } from "@/lib/eventAccess";
import { eventCapabilities, type EventCapabilities } from "@/lib/eventDashboard/capabilities";

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

/** What the viewer may see and do; computed once by `eventCapabilities` (lib/eventDashboard/capabilities.ts). */
export type EventDashboardPermissions = EventCapabilities;

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

  return {
    organisation: { id: organisation.id, slug: organisation.slug, name: organisation.name },
    event,
    userId: access.userId,
    origin: await getRequestOrigin(),
    now: new Date(),
    permissions: eventCapabilities(access.membership?.role ?? null, grant?.permissions ?? []),
  };
});
