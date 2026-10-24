import "server-only";

import { prisma } from "@/lib/db";
import { getMembership, isOrgAdmin } from "@/lib/permissions";
import { judgingPermissionsFor } from "@/lib/judgingPermissions";

/*
 * Server-side judging resolvers (docs/HACKATHON.md). The organisation comes
 * from the organisation slug, the event is always re-read inside that
 * organisation, and the result carries only ids. Callers authenticate first.
 */

/** A judge (org owner/admin or JUDGE collaborator) on one event. */
export type JudgeContext = {
  userId: string;
  organisationId: string;
  orgSlug: string;
  eventId: string;
  eventSlug: string;
  /** Org owner/admin; also allowed to manage judging. */
  isAdmin: boolean;
};

/** An organiser allowed to manage judging (the same check as organiser RSVP actions). */
export type JudgingOrganiserContext = {
  userId: string;
  organisationId: string;
  orgSlug: string;
  eventId: string;
  eventSlug: string;
};

async function loadEventInOrg(organisationSlug: string, eventId: string) {
  if (!organisationSlug || organisationSlug.length > 128 || !eventId || eventId.length > 128) return null;
  const org = await prisma.organisation.findUnique({ where: { slug: organisationSlug }, select: { id: true, slug: true } });
  if (!org) return null;
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: org.id }, select: { id: true, slug: true } });
  return event ? { org, event } : null;
}

/** "Can judge this event": organisation OWNER/ADMIN, or an event collaborator with JUDGE. */
export async function resolveJudgeContext(userId: string, organisationSlug: string, eventId: string): Promise<JudgeContext | null> {
  if (!userId) return null;
  const found = await loadEventInOrg(organisationSlug, eventId);
  if (!found) return null;
  const membership = await getMembership(userId, found.org.id);
  const isAdmin = Boolean(membership && isOrgAdmin(membership.role));
  const grant = isAdmin
    ? null
    : await prisma.eventCollaborator.findFirst({ where: { eventId: found.event.id, userId }, select: { permissions: true } });
  if (!judgingPermissionsFor(isAdmin, Boolean(membership), grant?.permissions ?? []).canJudge) return null;
  return { userId, organisationId: found.org.id, orgSlug: found.org.slug, eventId: found.event.id, eventSlug: found.event.slug, isAdmin };
}

/** "Can manage judging": organisation OWNER/ADMIN only, matching `canManageEvents` on RSVP actions. */
export async function resolveJudgingOrganiser(userId: string, organisationSlug: string, eventId: string): Promise<JudgingOrganiserContext | null> {
  if (!userId) return null;
  const found = await loadEventInOrg(organisationSlug, eventId);
  if (!found) return null;
  const membership = await getMembership(userId, found.org.id);
  if (!membership || !isOrgAdmin(membership.role)) return null;
  return { userId, organisationId: found.org.id, orgSlug: found.org.slug, eventId: found.event.id, eventSlug: found.event.slug };
}
