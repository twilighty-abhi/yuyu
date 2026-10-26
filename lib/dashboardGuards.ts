import "server-only";

import { cache } from "react";
import { notFound } from "next/navigation";
import { EventPermission, type MembershipRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canAccessEvent, canViewEventDashboard } from "@/lib/eventAccess";
import { isOrgAdmin, requireOrgDashboardAccess, requireOrgRole } from "@/lib/permissions";

/*
 * Dashboard route guards, awaited by the layout of each dashboard segment that
 * has a `loading.tsx`.
 *
 * A segment's `loading.tsx` is a Suspense boundary around its page and every
 * segment below it, but not around its own layout. Once that fallback renders,
 * the response has started streaming with a 200 status, so a `notFound()` or
 * `redirect()` thrown inside the boundary can no longer change it: the browser
 * gets a 200 carrying the not-found UI, or a client-side redirect. Running the
 * page's access check in the layout beside the `loading.tsx` resolves it
 * before streaming starts, so no access, wrong organisation, another
 * organisation's event, an unknown id and judge-only collaborators on
 * non-judging pages get a real 404 (or 307). Pages keep their own checks as
 * defence in depth; these mirror them exactly and never grant more.
 *
 * `tests/unit/dashboard-loading-boundaries.test.ts` pins where loading screens
 * may live and which guard each one's layout awaits.
 */

/** Organisation dashboard access: membership or an event/series collaborator grant. */
export const guardOrgDashboard = cache((orgSlug: string) => requireOrgDashboardAccess(orgSlug));

/** Organisation membership at `minRole` or above (redirects like `requireOrgRole`). */
export const guardOrgRole = cache((orgSlug: string, minRole: MembershipRole) => requireOrgRole(orgSlug, minRole));

/** The event belongs to the organisation and the viewer may open its dashboard (a JUDGE-only grant counts). */
export const guardEventDashboard = cache(async (orgSlug: string, eventId: string) => {
  const access = await guardOrgDashboard(orgSlug);
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: access.organisation.id }, select: { id: true } });
  if (!event) notFound();
  if (!access.membership && !(await canViewEventDashboard({ userId: access.userId, organisationId: access.organisation.id, eventId: event.id }))) notFound();
  return access;
});

/** An event page that needs one permission: organisation OWNER/ADMIN or that exact grant. */
export const guardEventPermission = cache(async (orgSlug: string, eventId: string, permission: EventPermission) => {
  const access = await guardEventDashboard(orgSlug, eventId);
  const isAdmin = Boolean(access.membership && isOrgAdmin(access.membership.role));
  if (!isAdmin && !(await canAccessEvent({ userId: access.userId, organisationId: access.organisation.id, eventId, permission }))) notFound();
  return access;
});

/** The series belongs to the organisation and the viewer may open its dashboard. */
export const guardSeriesDashboard = cache(async (orgSlug: string, seriesId: string) => {
  const access = await guardOrgDashboard(orgSlug);
  const series = await prisma.eventSeries.findFirst({ where: { id: seriesId, organisationId: access.organisation.id }, select: { id: true } });
  if (!series) notFound();
  if (!access.membership && !(await canViewEventDashboard({ userId: access.userId, organisationId: access.organisation.id, eventSeriesId: series.id }))) notFound();
  return access;
});

/** An organisation admin opening one of the organisation's own webhook endpoints. */
export const guardWebhookEndpoint = cache(async (orgSlug: string, endpointId: string) => {
  const access = await guardOrgRole(orgSlug, "ADMIN");
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: endpointId, organisationId: access.organisation.id }, select: { id: true } });
  if (!endpoint) notFound();
  return access;
});
