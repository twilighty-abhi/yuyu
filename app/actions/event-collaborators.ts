"use server";

import { EventPermission } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMembership, isOrgAdmin } from "@/lib/permissions";
import { recordAuditEvent } from "@/lib/audit";
import { createEventCollaboratorToken, hashEventCollaboratorToken } from "@/lib/eventCollaboratorToken";
import { enqueueCollaboratorInvite } from "@/lib/outbox";
import { getRequestOrigin } from "@/lib/publicUrl";
import { startOutboxWorker } from "@/lib/outboxWorker";
import type { ActionResult } from "./org";

const permissions = z.array(z.nativeEnum(EventPermission)).min(1).max(5);
const target = z.object({ organisationSlug: z.string().min(1), eventId: z.string().min(1).optional(), eventSeriesId: z.string().min(1).optional() }).refine((v) => Boolean(v.eventId) !== Boolean(v.eventSeriesId));
const inviteSchema = target.extend({ email: z.string().trim().email(), permissions });


async function requireAdmin(orgSlug: string, userId: string) {
  const org = await prisma.organisation.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;
  const membership = await getMembership(userId, org.id);
  return membership && isOrgAdmin(membership.role) ? org : null;
}

export async function createEventCollaboratorInvite(input: unknown): Promise<ActionResult<{ token: string; inviteId: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid collaborator invite." };
  const org = await requireAdmin(parsed.data.organisationSlug, session.user.id);
  if (!org) return { ok: false, error: "You do not have permission to invite collaborators." };
  const exists = parsed.data.eventId
    ? await prisma.event.findFirst({ where: { id: parsed.data.eventId, organisationId: org.id }, select: { id: true, title: true } })
    : await prisma.eventSeries.findFirst({ where: { id: parsed.data.eventSeriesId, organisationId: org.id }, select: { id: true, title: true } });
  if (!exists) return { ok: false, error: "Event not found." };
  const token = createEventCollaboratorToken();
  const origin = await getRequestOrigin();
  const invite = await prisma.$transaction(async (tx) => {
    const created = await tx.eventCollaboratorInvite.create({ data: {
    ...(parsed.data.eventId ? { eventId: parsed.data.eventId } : { eventSeriesId: parsed.data.eventSeriesId }),
    email: parsed.data.email.toLowerCase(), tokenHash: hashEventCollaboratorToken(token), permissions: parsed.data.permissions,
    createdByUserId: session.user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    } });
    await enqueueCollaboratorInvite(tx, { to: parsed.data.email.toLowerCase(), eventTitle: exists.title, inviteUrl: `${origin}/join/event-collaborator/${token}` });
    return created;
  });
  await recordAuditEvent({ action: "EVENT_COLLABORATOR_INVITED", actorUserId: session.user.id, organisationId: org.id, targetType: "EventCollaboratorInvite", targetId: invite.id });
  startOutboxWorker();
  revalidatePath(`/dashboard/${org.slug}`);
  if (parsed.data.eventId) revalidatePath(`/dashboard/${org.slug}/event/${parsed.data.eventId}`);
  revalidatePath("/dashboard");
  return { ok: true, data: { token, inviteId: invite.id } };
}

export async function revokeEventCollaborator(input: unknown): Promise<ActionResult> {
  const session = await auth();
  const parsed = target.extend({ collaboratorId: z.string().min(1) }).safeParse(input);
  if (!session?.user?.id || !parsed.success) return { ok: false, error: "Invalid request." };
  const org = await requireAdmin(parsed.data.organisationSlug, session.user.id);
  if (!org) return { ok: false, error: "You do not have permission." };
  const deleted = await prisma.eventCollaborator.deleteMany({ where: { id: parsed.data.collaboratorId, ...(parsed.data.eventId ? { eventId: parsed.data.eventId } : { eventSeriesId: parsed.data.eventSeriesId }) } });
  if (!deleted.count) return { ok: false, error: "Collaborator not found." };
  await recordAuditEvent({ action: "EVENT_COLLABORATOR_REVOKED", actorUserId: session.user.id, organisationId: org.id, targetType: "EventCollaborator", targetId: parsed.data.collaboratorId });
  if (parsed.data.eventId) revalidatePath(`/dashboard/${org.slug}/event/${parsed.data.eventId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateEventCollaboratorPermissions(input: unknown): Promise<ActionResult> {
  const session = await auth();
  const parsed = target.extend({ collaboratorId: z.string().min(1), permissions }).safeParse(input);
  if (!session?.user?.id || !parsed.success) return { ok: false, error: "Invalid collaborator permissions." };
  const org = await requireAdmin(parsed.data.organisationSlug, session.user.id);
  if (!org) return { ok: false, error: "You do not have permission." };
  const updated = await prisma.eventCollaborator.updateMany({ where: { id: parsed.data.collaboratorId, ...(parsed.data.eventId ? { eventId: parsed.data.eventId } : { eventSeriesId: parsed.data.eventSeriesId }) }, data: { permissions: parsed.data.permissions } });
  if (!updated.count) return { ok: false, error: "Collaborator not found." };
  await recordAuditEvent({ action: "EVENT_COLLABORATOR_PERMISSIONS_UPDATED", actorUserId: session.user.id, organisationId: org.id, targetType: "EventCollaborator", targetId: parsed.data.collaboratorId, metadata: { permissions: parsed.data.permissions.join(",") } });
  if (parsed.data.eventId) revalidatePath(`/dashboard/${org.slug}/event/${parsed.data.eventId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
