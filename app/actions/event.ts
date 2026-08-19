"use server";

import { EventPrivacyType, EventStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canCreateEvent,
  canPublishEvents,
  getMembership,
} from "@/lib/permissions";
import { slugifyTitle, withSlugSuffix } from "@/lib/slug";
import {
  createEventSchema,
  cloneEventSchema,
  deleteEventSchema,
  updateEventSchema,
  updateEventSlugSchema,
} from "@/lib/validators";
import type { ActionResult } from "./org";
import { flattenZodErrors } from "./utils";
import { getPublicUrl, uploadFile } from "@/lib/storage";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { validateEventCoverImage } from "@/lib/imageValidation";

const MAX_COVER_IMAGE_BYTES = 5 * 1024 * 1024;

export async function uploadEventCoverImage(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("upload", session.user.id)) {
    return { ok: false, error: "Too many uploads. Please try again later." };
  }

  const organisationSlug = String(formData.get("organisationSlug") ?? "").trim();
  const file = formData.get("file");
  if (!organisationSlug || !(file instanceof File)) {
    return { ok: false, error: "Choose an image to upload." };
  }
  if (file.size === 0 || file.size > MAX_COVER_IMAGE_BYTES) {
    return { ok: false, error: "Cover images must be 5 MB or smaller." };
  }
  const inspectedImage = await validateEventCoverImage(file);
  if ("error" in inspectedImage) return { ok: false, error: inspectedImage.error };

  const org = await prisma.organisation.findUnique({ where: { slug: organisationSlug } });
  if (!org) return { ok: false, error: "Organisation not found." };
  const membership = await getMembership(session.user.id, org.id);
  if (!canCreateEvent(membership)) {
    return { ok: false, error: "You do not have permission to upload cover images." };
  }

  try {
    const key = `organisations/${org.id}/event-covers/${crypto.randomUUID()}.${inspectedImage.extension}`;
    await uploadFile({
      key,
      body: file,
      contentType: inspectedImage.contentType,
      organisationId: org.id,
    });
    return { ok: true, data: { url: getPublicUrl(key) } };
  } catch (error) {
    console.error("[event] Cover image upload failed:", error);
    return { ok: false, error: "Could not upload the cover image." };
  }
}

function revalidateEventPaths(orgSlug: string, eventSlug: string, eventId: string) {
  revalidatePath(`/${orgSlug}`);
  revalidatePath(`/${orgSlug}/${eventSlug}`);
  revalidatePath(`/dashboard/${orgSlug}`);
  revalidatePath(`/dashboard/${orgSlug}/event/${eventId}`);
}

export async function createEvent(input: unknown): Promise<ActionResult<{ id: string; slug: string }>> {
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
    return {
      ok: false,
      error: "Only owners and admins can create events.",
    };
  }

  if (
    data.status !== EventStatus.DRAFT &&
    !canPublishEvents(membership)
  ) {
    return {
      ok: false,
      error: "Only owners and admins can publish or hide events.",
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
    const created = await prisma.event.create({
      data: {
        organisationId: org.id,
        title: data.title,
        slug,
        description: data.description ?? "",
        tags: data.tags ?? [],
        showRegistrationCount: data.showRegistrationCount ?? true,
        coverImageUrl: data.coverImageUrl || null,
        startDateTime: data.startDateTime,
        endDateTime: data.endDateTime,
        timezone: data.timezone,
        location: data.location ?? "",
        mapLinkUrl: data.mapLinkUrl || null,
        isOnline: data.isOnline ?? false,
        capacity: data.capacity ?? null,
        status: data.status ?? EventStatus.DRAFT,
        privacyType: data.privacyType ?? EventPrivacyType.PUBLIC,
      },
    });

    revalidateEventPaths(org.slug, slug, created.id);
    return { ok: true, data: { id: created.id, slug: created.slug } };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not create event." };
  }
}

export async function updateEvent(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = updateEventSchema.safeParse(input);
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
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canCreateEvent(membership)) {
    return { ok: false, error: "You do not have permission to edit events." };
  }

  if (
    data.status !== EventStatus.DRAFT &&
    !canPublishEvents(membership)
  ) {
    return {
      ok: false,
      error: "Only owners and admins can change visibility.",
    };
  }

  const event = await prisma.event.findFirst({
    where: { id: data.eventId, organisationId: org.id },
  });
  if (!event) return { ok: false, error: "Event not found." };

  try {
    await prisma.event.update({
      where: { id: event.id },
      data: {
        title: data.title,
        description: data.description ?? "",
        tags: data.tags ?? [],
        showRegistrationCount: data.showRegistrationCount ?? true,
        coverImageUrl: data.coverImageUrl || null,
        startDateTime: data.startDateTime,
        endDateTime: data.endDateTime,
        timezone: data.timezone,
        location: data.location ?? "",
        mapLinkUrl: data.mapLinkUrl || null,
        isOnline: data.isOnline ?? false,
        capacity: data.capacity ?? null,
        status: data.status,
        privacyType: data.privacyType,
      },
    });

    revalidateEventPaths(org.slug, event.slug, event.id);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not update event." };
  }
}

export async function deleteEvent(input: unknown): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = deleteEventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canCreateEvent(membership)) {
    return { ok: false, error: "You do not have permission to delete events." };
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: org.id },
  });
  if (!event) return { ok: false, error: "Event not found." };

  const slug = event.slug;
  try {
    await prisma.event.delete({ where: { id: event.id } });
    revalidatePath(`/${org.slug}`);
    revalidatePath(`/${org.slug}/${slug}`);
    revalidatePath(`/dashboard/${org.slug}`);
    return { ok: true };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not delete event." };
  }
}

export async function updateEventSlug(
  input: unknown,
): Promise<ActionResult<{ slug: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = updateEventSlugSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId, slug } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
    select: { id: true, slug: true },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canCreateEvent(membership)) {
    return { ok: false, error: "You do not have permission to edit events." };
  }

  const event = await prisma.event.findFirst({
    where: { id: eventId, organisationId: org.id },
    select: { id: true, slug: true },
  });
  if (!event) return { ok: false, error: "Event not found." };

  if (event.slug === slug) {
    return { ok: true, data: { slug } };
  }

  const exists = await prisma.event.findUnique({
    where: { organisationId_slug: { organisationId: org.id, slug } },
    select: { id: true },
  });
  if (exists) {
    return {
      ok: false,
      error: "That URL is already taken for this organisation.",
      fieldErrors: { slug: ["Already taken"] },
    };
  }

  try {
    await prisma.event.update({ where: { id: event.id }, data: { slug } });
    // Revalidate both old and new public URLs + dashboard.
    revalidateEventPaths(org.slug, event.slug, event.id);
    revalidateEventPaths(org.slug, slug, event.id);
    return { ok: true, data: { slug } };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not update event URL." };
  }
}

export async function cloneEvent(
  input: unknown,
): Promise<ActionResult<{ eventId: string }>> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in." };
  }

  const parsed = cloneEventSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid input.",
      fieldErrors: flattenZodErrors(parsed.error),
    };
  }

  const { organisationSlug, eventId } = parsed.data;
  const org = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
    select: { id: true, slug: true },
  });
  if (!org) return { ok: false, error: "Organisation not found." };

  const membership = await getMembership(session.user.id, org.id);
  if (!canCreateEvent(membership)) {
    return { ok: false, error: "Only owners and admins can create events." };
  }

  const source = await prisma.event.findFirst({
    where: { id: eventId, organisationId: org.id },
  });
  if (!source) return { ok: false, error: "Event not found." };

  const newTitle = `${source.title} (copy)`;
  const baseSlug = slugifyTitle(newTitle);
  let slug = baseSlug;
  let attempt = 0;
  while (
    await prisma.event.findUnique({
      where: { organisationId_slug: { organisationId: org.id, slug } },
      select: { id: true },
    })
  ) {
    attempt += 1;
    if (attempt > 50) {
      return { ok: false, error: "Could not generate a unique URL slug." };
    }
    slug = withSlugSuffix(baseSlug, attempt);
  }

  try {
    const created = await prisma.event.create({
      data: {
        organisationId: org.id,
        title: newTitle,
        slug,
        description: source.description ?? "",
        coverImageUrl: source.coverImageUrl,
        startDateTime: source.startDateTime,
        endDateTime: source.endDateTime,
        timezone: source.timezone,
        location: source.location ?? "",
        mapLinkUrl: source.mapLinkUrl,
        isOnline: source.isOnline,
        capacity: source.capacity,
        // Clone as draft to prevent accidental double-publishing.
        status: EventStatus.DRAFT,
        privacyType: source.privacyType,
      },
    });

    revalidateEventPaths(org.slug, created.slug, created.id);
    return { ok: true, data: { eventId: created.id } };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "Could not clone event." };
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

  revalidateEventPaths(org.slug, event.slug, event.id);
  return { ok: true };
}
