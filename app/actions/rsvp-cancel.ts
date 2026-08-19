"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { ActionResult } from "./org";

/**
 * Cancel an RSVP.  The caller must either:
 *  – be the logged-in user who owns the RSVP, OR
 *  – supply the correct `checkInToken` (for guest cancellation).
 *
 * When a CONFIRMED RSVP is cancelled and there are WAITLISTED RSVPs,
 * the oldest waitlisted RSVP is auto-promoted to CONFIRMED.
 */
export async function cancelRsvp(input: {
  checkInToken: string;
}): Promise<ActionResult<{ cancelled: true }>> {
  const { checkInToken } = input;
  if (!checkInToken?.trim()) {
    return { ok: false, error: "Missing token." };
  }

  const rsvp = await prisma.rSVP.findUnique({
    where: { checkInToken: checkInToken.trim() },
    include: {
      event: {
        select: {
          id: true,
          slug: true,
          organisation: { select: { slug: true } },
        },
      },
      eventInstance: {
        select: {
          id: true,
          series: {
            select: { organisation: { select: { slug: true } } },
          },
        },
      },
    },
  });

  if (!rsvp) {
    return { ok: false, error: "RSVP not found." };
  }

  // Authorization: must own the RSVP
  const session = await auth();
  const isOwner =
    (rsvp.userId && session?.user?.id === rsvp.userId) ||
    // Guest flow: the token itself is the auth proof
    (!rsvp.userId && !!checkInToken);

  if (!isOwner) {
    return { ok: false, error: "You can only cancel your own registration." };
  }

  if (rsvp.checkedInAt) {
    return { ok: false, error: "Cannot cancel — you have already checked in." };
  }

  const wasConfirmed = rsvp.status === "CONFIRMED";

  // Delete the RSVP
  await prisma.rSVP.delete({ where: { id: rsvp.id } });

  // Auto-promote oldest waitlisted RSVP if a confirmed spot opened
  if (wasConfirmed) {
    const waitlistKey = rsvp.eventId
      ? { eventId: rsvp.eventId }
      : rsvp.eventInstanceId
        ? { eventInstanceId: rsvp.eventInstanceId }
        : null;

    if (waitlistKey) {
      const nextWaitlisted = await prisma.rSVP.findFirst({
        where: { ...waitlistKey, status: "WAITLISTED" },
        orderBy: { createdAt: "asc" },
      });

      if (nextWaitlisted) {
        await prisma.rSVP.update({
          where: { id: nextWaitlisted.id },
          data: { status: "CONFIRMED" },
        });
      }
    }
  }

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
