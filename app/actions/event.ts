"use server";

import { EventStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canCreateEvent,
  canPublishEvents,
  getMembership,
} from "@/lib/permissions";
import { slugifyTitle, withSlugSuffix } from "@/lib/slug";
import { createEventSchema } from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";

export async function createEvent(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const data = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: data.organisationSlug },
  });
  if (!org) {
    return { ok: false, error: "Organisation not found." };
  }

  const membership = await getMembership(session.user.id, org.id);
  if (!canCreateEvent(membership)) {
    return { ok: false, error: "You are not a member of this organisation." };
  }

  if (
    data.status === EventStatus.PUBLISHED &&
    !canPublishEvents(membership)
  ) {
    return {
      ok: false,
      error: "Only owners and admins can publish events.",
    };
  }

  const baseSlug = slugifyTitle(data.title);
  let slug = baseSlug;
  let attempt = 0;
  while (
    await prisma.event.findUnique({
      where: {
        organisationId_slug: { organisationId: org.id, slug },
      },
    })
  ) {
    attempt += 1;
    if (attempt > 50) {
      return { ok: false, error: "Could not generate a unique URL slug." };
    }
    slug = withSlugSuffix(baseSlug, attempt);
  }

  try {
    await prisma.event.create({
      data: {
        organisationId: org.id,
        title: data.title,
        slug,
        description: data.description ?? "",
        coverImageUrl: data.coverImageUrl || null,
        startDateTime: data.startDateTime,
        endDateTime: data.endDateTime,
        timezone: data.timezone,
        location: data.location ?? "",
        isOnline: data.isOnline ?? false,
        capacity: data.capacity ?? null,
        status: data.status ?? EventStatus.DRAFT,
      },
    });

    revalidatePath(`/${org.slug}`);
    revalidatePath(`/${org.slug}/${slug}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create event." };
  }
}

export async function publishEvent(input: {
  organisationSlug: string;
  eventSlug: string;
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
  if (!canPublishEvents(membership)) {
    return { ok: false, error: "Only owners and admins can publish." };
  }

  const event = await prisma.event.findUnique({
    where: {
      organisationId_slug: {
        organisationId: org.id,
        slug: input.eventSlug,
      },
    },
  });
  if (!event) return { ok: false, error: "Event not found." };

  await prisma.event.update({
    where: { id: event.id },
    data: { status: EventStatus.PUBLISHED },
  });

  revalidatePath(`/${org.slug}`);
  revalidatePath(`/${org.slug}/${event.slug}`);
  return { ok: true };
}
