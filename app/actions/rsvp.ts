"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { rsvpGuestSchema, rsvpLoggedInSchema } from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

function normalizeGuestEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function submitRsvp(
  input: unknown,
): Promise<ActionResult<{ count: number }>> {
  const session = await auth();

  if (session?.user?.id) {
    const parsed = rsvpLoggedInSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "Invalid input.",
        fieldErrors: flattenZodErrors(parsed.error),
      };
    }
    const { orgSlug, eventSlug } = parsed.data;

    const org = await prisma.organisation.findUnique({
      where: { slug: orgSlug },
    });
    if (!org) return { ok: false, error: "Event not found." };

    const event = await prisma.event.findUnique({
      where: {
        organisationId_slug: { organisationId: org.id, slug: eventSlug },
      },
    });
    if (!event || event.status !== "PUBLISHED") {
      return { ok: false, error: "This event is not open for RSVP." };
    }

    if (event.capacity != null) {
      const count = await prisma.rSVP.count({ where: { eventId: event.id } });
      if (count >= event.capacity) {
        return { ok: false, error: "This event is at capacity." };
      }
    }

    const attendeeKey = `user:${session.user.id}`;

    try {
      await prisma.rSVP.create({
        data: {
          eventId: event.id,
          userId: session.user.id,
          guestEmail: null,
          attendeeKey,
        },
      });
      const count = await prisma.rSVP.count({ where: { eventId: event.id } });
      revalidatePath(`/${orgSlug}/${eventSlug}`);
      return { ok: true, data: { count } };
    } catch (e: unknown) {
      if (
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        (e as { code: string }).code === "P2002"
      ) {
        return { ok: false, error: "You have already RSVP’d for this event." };
      }
      console.error(e);
      return { ok: false, error: "Could not save your RSVP." };
    }
  }

  const parsed = rsvpGuestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { orgSlug, eventSlug, guestEmail } = parsed.data;
  const emailNorm = normalizeGuestEmail(guestEmail);

  const org = await prisma.organisation.findUnique({
    where: { slug: orgSlug },
  });
  if (!org) return { ok: false, error: "Event not found." };

  const event = await prisma.event.findUnique({
    where: {
      organisationId_slug: { organisationId: org.id, slug: eventSlug },
    },
  });
  if (!event || event.status !== "PUBLISHED") {
    return { ok: false, error: "This event is not open for RSVP." };
  }

  if (event.capacity != null) {
    const count = await prisma.rSVP.count({ where: { eventId: event.id } });
    if (count >= event.capacity) {
      return { ok: false, error: "This event is at capacity." };
    }
  }

  const attendeeKey = `guest:${emailNorm}`;

  try {
    await prisma.rSVP.create({
      data: {
        eventId: event.id,
        userId: null,
        guestEmail: emailNorm,
        attendeeKey,
      },
    });
    const count = await prisma.rSVP.count({ where: { eventId: event.id } });
    revalidatePath(`/${orgSlug}/${eventSlug}`);
    return { ok: true, data: { count } };
  } catch (e: unknown) {
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code: string }).code === "P2002"
    ) {
      return {
        ok: false,
        error: "This email is already registered for this event.",
      };
    }
    console.error(e);
    return { ok: false, error: "Could not save your RSVP." };
  }
}
