"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canManageEvents, getMembership } from "@/lib/permissions";
import { deleteRsvpSchema } from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

export async function deleteRsvp(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = deleteRsvpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, eventInstanceId, rsvpId } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) {
    return {
      ok: false,
      error: "You do not have permission to manage attendees.",
    };
  }

  if (eventId) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, organisationId: org.id },
    });
    if (!event) return { ok: false, error: "Event not found." };

    const rsvp = await prisma.rSVP.findFirst({
      where: { id: rsvpId, eventId: event.id },
    });
    if (!rsvp) return { ok: false, error: "RSVP not found." };

    await prisma.rSVP.delete({ where: { id: rsvp.id } });

    revalidatePath(`/${org.slug}/${event.slug}`);
    revalidatePath(`/${org.slug}`);
    revalidatePath(`/dashboard/${org.slug}`);
    revalidatePath(`/dashboard/${org.slug}/event/${event.id}`);
    return { ok: true };
  }

  if (eventInstanceId) {
    const instance = await prisma.eventInstance.findFirst({
      where: {
        id: eventInstanceId,
        series: { organisationId: org.id },
      },
    });
    if (!instance) return { ok: false, error: "Event not found." };

    const rsvp = await prisma.rSVP.findFirst({
      where: { id: rsvpId, eventInstanceId: instance.id },
    });
    if (!rsvp) return { ok: false, error: "RSVP not found." };

    await prisma.rSVP.delete({ where: { id: rsvp.id } });

    revalidatePath(`/${org.slug}/i/${instance.id}`);
    revalidatePath(`/${org.slug}`);
    revalidatePath(`/dashboard/${org.slug}`);
    return { ok: true };
  }

  return { ok: false, error: "Event not found." };
}
