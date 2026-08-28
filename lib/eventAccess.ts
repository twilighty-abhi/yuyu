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
  const membership = await getMembership(params.userId, params.organisationId);
  if (membership) return true;
  const grant = await prisma.eventCollaborator.findFirst({
    where: { userId: params.userId, ...(params.eventId ? { eventId: params.eventId } : { eventSeriesId: params.eventSeriesId }) },
    select: { id: true },
  });
  return Boolean(grant);
}
