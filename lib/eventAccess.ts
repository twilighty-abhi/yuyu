import "server-only";

import { EventPermission } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getMembership, isOrgAdmin } from "@/lib/permissions";

export async function canAccessEvent(params: {
  userId: string;
  organisationId: string;
  eventId?: string;
  eventSeriesId?: string;
  permission: EventPermission;
}) {
  if (Boolean(params.eventId) === Boolean(params.eventSeriesId)) return false;
  const targetBelongsToOrganisation = params.eventId
    ? await prisma.event.findFirst({ where: { id: params.eventId, organisationId: params.organisationId }, select: { id: true } })
    : await prisma.eventSeries.findFirst({ where: { id: params.eventSeriesId, organisationId: params.organisationId }, select: { id: true } });
  if (!targetBelongsToOrganisation) return false;
  const membership = await getMembership(params.userId, params.organisationId);
  if (membership && isOrgAdmin(membership.role)) return true;
  const grant = await prisma.eventCollaborator.findFirst({
    where: {
      userId: params.userId,
      ...(params.eventId ? { eventId: params.eventId } : { eventSeriesId: params.eventSeriesId }),
      permissions: { has: params.permission },
    },
    select: { id: true },
  });
  return Boolean(grant);
}

export async function canViewEventDashboard(params: {
  userId: string;
  organisationId: string;
  eventId?: string;
  eventSeriesId?: string;
}) {
  if (Boolean(params.eventId) === Boolean(params.eventSeriesId)) return false;
  const targetBelongsToOrganisation = params.eventId
    ? await prisma.event.findFirst({ where: { id: params.eventId, organisationId: params.organisationId }, select: { id: true } })
    : await prisma.eventSeries.findFirst({ where: { id: params.eventSeriesId, organisationId: params.organisationId }, select: { id: true } });
  if (!targetBelongsToOrganisation) return false;
  const membership = await getMembership(params.userId, params.organisationId);
  if (membership) return true;
  const grant = await prisma.eventCollaborator.findFirst({
    where: { userId: params.userId, ...(params.eventId ? { eventId: params.eventId } : { eventSeriesId: params.eventSeriesId }) },
    select: { id: true },
  });
  return Boolean(grant);
}
