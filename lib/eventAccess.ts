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

/**
 * Registration management for an RSVP target: organisation OWNER/ADMIN, or the
 * exact `MANAGE_REGISTRATIONS` grant on the event (standalone RSVPs) or on the
 * occurrence's series (series RSVPs). The target must belong to the organisation.
 */
export async function canManageRegistrationsFor(params: {
  userId: string;
  organisationId: string;
  eventId?: string | null;
  eventInstanceId?: string | null;
}) {
  if (Boolean(params.eventId) === Boolean(params.eventInstanceId)) return false;
  if (params.eventId) {
    return canAccessEvent({ userId: params.userId, organisationId: params.organisationId, eventId: params.eventId, permission: EventPermission.MANAGE_REGISTRATIONS });
  }
  const instance = await prisma.eventInstance.findFirst({
    where: { id: params.eventInstanceId!, series: { organisationId: params.organisationId } },
    select: { eventSeriesId: true },
  });
  if (!instance) return false;
  return canAccessEvent({ userId: params.userId, organisationId: params.organisationId, eventSeriesId: instance.eventSeriesId, permission: EventPermission.MANAGE_REGISTRATIONS });
}
