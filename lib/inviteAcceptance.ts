import "server-only";

import { prisma } from "@/lib/db";
import { hashEventCollaboratorToken } from "@/lib/eventCollaboratorToken";

export type InviteAcceptance =
  | { ok: true; href: string }
  | { ok: false; reason: "unavailable" | "wrong-account" };

export async function acceptOrganisationInviteToken(token: string, userId: string): Promise<InviteAcceptance> {
  return prisma.$transaction(async (tx) => {
    const invite = await tx.organisationInvite.findUnique({
      where: { token },
      select: { id: true, role: true, organisationId: true, usedAt: true, expiresAt: true, organisation: { select: { slug: true } } },
    });
    const now = new Date();
    if (!invite || invite.usedAt || (invite.expiresAt && invite.expiresAt <= now)) return { ok: false, reason: "unavailable" };
    const claim = await tx.organisationInvite.updateMany({
      where: { id: invite.id, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { usedAt: now, usedByUserId: userId },
    });
    if (claim.count !== 1) return { ok: false, reason: "unavailable" };
    await tx.membership.upsert({
      where: { userId_organisationId: { userId, organisationId: invite.organisationId } },
      create: { userId, organisationId: invite.organisationId, role: invite.role },
      update: {},
    });
    await tx.auditEvent.create({ data: { action: "ORGANISATION_INVITE_ACCEPTED", actorUserId: userId, organisationId: invite.organisationId, targetType: "OrganisationInvite", targetId: invite.id } });
    return { ok: true, href: `/dashboard/${invite.organisation.slug}` };
  });
}

export async function acceptEventCollaboratorInviteToken(token: string, user: { id: string; email: string }): Promise<InviteAcceptance> {
  const tokenHash = hashEventCollaboratorToken(token);
  return prisma.$transaction(async (tx) => {
    const invite = await tx.eventCollaboratorInvite.findUnique({
      where: { tokenHash },
      select: {
        id: true, email: true, eventId: true, eventSeriesId: true, permissions: true, usedAt: true, expiresAt: true,
        event: { select: { organisation: { select: { id: true, slug: true } } } },
        series: { select: { organisation: { select: { id: true, slug: true } } } },
      },
    });
    const now = new Date();
    if (!invite || invite.usedAt || invite.expiresAt <= now) return { ok: false, reason: "unavailable" };
    if (invite.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) return { ok: false, reason: "wrong-account" };
    const claim = await tx.eventCollaboratorInvite.updateMany({
      where: { id: invite.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now, usedByUserId: user.id },
    });
    if (claim.count !== 1) return { ok: false, reason: "unavailable" };
    if (invite.eventId) {
      await tx.eventCollaborator.upsert({
        where: { eventId_userId: { eventId: invite.eventId, userId: user.id } },
        create: { eventId: invite.eventId, userId: user.id, permissions: invite.permissions },
        update: { permissions: invite.permissions },
      });
    } else if (invite.eventSeriesId) {
      await tx.eventCollaborator.upsert({
        where: { eventSeriesId_userId: { eventSeriesId: invite.eventSeriesId, userId: user.id } },
        create: { eventSeriesId: invite.eventSeriesId, userId: user.id, permissions: invite.permissions },
        update: { permissions: invite.permissions },
      });
    } else {
      throw new Error("Collaborator invite has no target.");
    }
    const organisation = invite.event?.organisation ?? invite.series?.organisation;
    if (!organisation) throw new Error("Collaborator invite target has no organisation.");
    await tx.auditEvent.create({ data: { action: "EVENT_COLLABORATOR_INVITE_ACCEPTED", actorUserId: user.id, organisationId: organisation.id, targetType: "EventCollaboratorInvite", targetId: invite.id } });
    const href = invite.eventId ? `/dashboard/${organisation.slug}/event/${invite.eventId}` : `/dashboard/${organisation.slug}/series/${invite.eventSeriesId}`;
    return { ok: true, href };
  });
}
