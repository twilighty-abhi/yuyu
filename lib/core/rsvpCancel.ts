import "server-only";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { enqueueRsvpStatusNotification } from "@/lib/outbox";
import { recordAuditEvent } from "@/lib/audit";
import type { ActionResult } from "@/app/actions/org";
import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { EventPrivacyType, RsvpStatus } from "@prisma/client";
import { emitWebhookEvent, type RsvpWebhookSnapshot } from "@/lib/webhooks/emit";

const cancelRsvpSchema = z.object({ checkInToken: z.string().trim().min(8).max(256) }).strict();

/**
 * Cancel an RSVP.  The caller must either:
 *  – be the logged-in user who owns the RSVP, OR
 *  – supply the correct `checkInToken` (for guest cancellation).
 *
 * When a CONFIRMED RSVP is cancelled and there are WAITLISTED RSVPs,
 * the oldest waitlisted RSVP is auto-promoted to CONFIRMED.
 */
export async function cancelRsvpForUser(actorUserId: string | null, input: unknown): Promise<ActionResult<{ cancelled: true }>> {
  const parsed = cancelRsvpSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Missing token." };
  }
  const { checkInToken } = parsed.data;
  if (await isActionRateLimited("rsvp", checkInToken)) return { ok: false, error: "Too many cancellation attempts. Please try again shortly." };

  const rsvp = await prisma.rSVP.findUnique({
    where: { checkInToken: checkInToken.trim() },
    include: {
      event: {
        select: {
          id: true,
          slug: true,
          title: true,
          privacyType: true,
          organisation: { select: { id: true, slug: true } },
        },
      },
      eventInstance: {
        select: {
          id: true,
          series: {
            select: { title: true, privacyType: true, organisation: { select: { id: true, slug: true } } },
          },
        },
      },
    },
  });

  if (!rsvp) {
    return { ok: false, error: "RSVP not found." };
  }

  // Authorization: must own the RSVP
  const session = actorUserId ? { user: { id: actorUserId } } : null;
  const isOwner =
    (rsvp.userId && session?.user?.id === rsvp.userId) ||
    // Guest flow: the token itself is the auth proof
    (!rsvp.userId && !!checkInToken);

  if (!isOwner) {
    return { ok: false, error: "You can only cancel your own registration." };
  }

  const cancellation = await prisma.$transaction(async (tx) => {
    if (rsvp.eventId) {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${rsvp.eventId} FOR UPDATE`;
    } else if (rsvp.eventInstanceId) {
      await tx.$queryRaw`SELECT "id" FROM "EventInstance" WHERE "id" = ${rsvp.eventInstanceId} FOR UPDATE`;
    }
    const current = await tx.rSVP.findUnique({ where: { id: rsvp.id } });
    if (!current) return { error: "RSVP not found." };
    if (current.checkedInAt) return { error: "Cannot cancel — you have already checked in." };
    let promotedId: string | null = null;
    await tx.rSVP.delete({ where: { id: current.id } });
    const privacyType = rsvp.event?.privacyType ?? rsvp.eventInstance?.series.privacyType;
    if (current.status === "CONFIRMED" && privacyType !== EventPrivacyType.APPROVAL_REQUIRED) {
      const target = current.eventId ? { eventId: current.eventId } : { eventInstanceId: current.eventInstanceId! };
      const nextWaitlisted = await tx.rSVP.findFirst({
        where: { ...target, status: "WAITLISTED" },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { email: true } } },
      });
      if (nextWaitlisted) {
        const promoted = await tx.rSVP.updateMany({
          where: { id: nextWaitlisted.id, status: "WAITLISTED" },
          data: { status: "CONFIRMED" },
        });
        if (promoted.count === 1) promotedId = nextWaitlisted.id;
        const to = nextWaitlisted.user?.email?.trim() || nextWaitlisted.guestEmail;
        if (promoted.count === 1 && to) {
          await enqueueRsvpStatusNotification(tx, {
            to,
            eventTitle: rsvp.event?.title ?? rsvp.eventInstance!.series.title,
            approved: true,
            checkInToken: nextWaitlisted.checkInToken,
          });
        }
      }
    }
    const snapshot: RsvpWebhookSnapshot = { id: current.id, eventId: current.eventId, eventInstanceId: current.eventInstanceId, userId: current.userId, guestName: current.guestName, createdAt: current.createdAt, checkedInAt: current.checkedInAt };
    return { error: null, snapshot, previousStatus: current.status, promotedId };
  });
  if (cancellation.error) return { ok: false, error: cancellation.error };
  if (cancellation.snapshot && cancellation.previousStatus) {
    emitWebhookEvent({ type: "registration.status_changed", rsvpId: cancellation.snapshot.id, status: "CANCELLED", previousStatus: cancellation.previousStatus, snapshot: cancellation.snapshot });
  }
  if (cancellation.promotedId) {
    emitWebhookEvent({ type: "registration.status_changed", rsvpId: cancellation.promotedId, status: RsvpStatus.CONFIRMED, previousStatus: RsvpStatus.WAITLISTED });
  }

  await recordAuditEvent({
    action: "RSVP_CANCELLED",
    actorUserId: session?.user?.id ?? null,
    organisationId: rsvp.event?.organisation.id ?? rsvp.eventInstance?.series.organisation.id,
    targetType: "RSVP",
    targetId: rsvp.id,
  });

  // Revalidate public pages
  const orgSlug =
    rsvp.event?.organisation.slug ??
    rsvp.eventInstance?.series.organisation.slug;
  if (orgSlug) {
    revalidatePath(`/${orgSlug}`);
    if (rsvp.event) {
      revalidatePath(`/${orgSlug}/${rsvp.event.slug}`);
    }
  }

  return { ok: true, data: { cancelled: true } };
}
