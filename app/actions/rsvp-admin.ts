"use server";

import { revalidatePath } from "next/cache";
import { RsvpStatus } from "@prisma/client";
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

export async function restoreRsvp(input: {
  organisationSlug: string;
  eventId?: string | null;
  eventInstanceId?: string | null;
  userId?: string | null;
  guestEmail?: string | null;
  guestName?: string | null;
  status: RsvpStatus;
  attendeeKey: string;
  checkInToken: string;
  checkedInAt?: Date | string | null;
  createdAt: Date | string;
  answers: Array<{
    fieldId: string;
    valueText?: string | null;
    valueBool?: boolean | null;
    valueNumber?: number | null;
    valueDate?: Date | string | null;
  }>;
}): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const org = await prisma.organisation.findUnique({
    where: { slug: input.organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canManageEvents(membership)) {
    return {
      ok: false,
      error: "You do not have permission to restore RSVPs.",
    };
  }

  await prisma.rSVP.create({
    data: {
      eventId: input.eventId || null,
      eventInstanceId: input.eventInstanceId || null,
      userId: input.userId || null,
      guestEmail: input.guestEmail || null,
      guestName: input.guestName || null,
      status: input.status,
      attendeeKey: input.attendeeKey,
      checkInToken: input.checkInToken,
      checkedInAt: input.checkedInAt ? new Date(input.checkedInAt) : null,
      createdAt: new Date(input.createdAt),
      answers: {
        create: input.answers.map((ans) => ({
          fieldId: ans.fieldId,
          valueText: ans.valueText || null,
          valueBool: ans.valueBool ?? null,
          valueNumber: ans.valueNumber ?? null,
          valueDate: ans.valueDate ? new Date(ans.valueDate) : null,
        })),
      },
    },
  });

  if (input.eventId) {
    const event = await prisma.event.findUnique({ where: { id: input.eventId } });
    if (event) {
      revalidatePath(`/${org.slug}/${event.slug}`);
      revalidatePath(`/dashboard/${org.slug}/event/${event.id}`);
    }
  } else if (input.eventInstanceId) {
    revalidatePath(`/${org.slug}/i/${input.eventInstanceId}`);
  }
  revalidatePath(`/${org.slug}`);
  revalidatePath(`/dashboard/${org.slug}`);

  return { ok: true };
}
