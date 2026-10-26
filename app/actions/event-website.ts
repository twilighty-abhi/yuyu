"use server";

import {
  ContentVisibility,
  EventPageSectionType,
  EventPermission,
  EventStatus,
  SponsorTier,
} from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isUserEmailVerified } from "@/lib/permissions";
import { slugifyTitle, withSlugSuffix } from "@/lib/slug";
import { sanitizeRichText } from "@/lib/richText";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { createSafeWebpDerivative } from "@/lib/imageValidation";
import { getPublicUrl, uploadFile } from "@/lib/storage";
import type { ActionResult } from "./org";
import {
  eventWebsiteContextForUser,
  eventWebsiteTarget,
  revalidateEventWebsitePaths,
  setEventSessionDelayForUser,
} from "@/lib/core/eventProgramme";
import { isOrganisationUploadUrl, isUploadedImageUrl } from "@/lib/uploadUrl";

const http = z
  .string()
  .url()
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Use an HTTP(S) URL");
const optionalUrl = z.union([http, z.literal(""), z.null()]).optional();
// Safe derivatives use an application-relative delivery URL in local/self-hosted
// setups where NEXT_PUBLIC_BASE_URL is intentionally not configured.
const optionalImageUrl = z
  .union([
    z.string().refine(isUploadedImageUrl, "Invalid uploaded image URL"),
    z.literal(""),
    z.null(),
  ])
  .optional();
const target = eventWebsiteTarget;
const visibility = z
  .nativeEnum(ContentVisibility)
  .default(ContentVisibility.DRAFT);
const MAX_SPEAKER_PHOTO_BYTES = 5 * 1024 * 1024;

async function context(
  input: z.infer<typeof target>,
  permission: EventPermission,
) {
  const session = await auth();
  return eventWebsiteContextForUser(session?.user?.id ?? null, input, permission);
}
function paths(orgSlug: string, event: { id: string; slug: string }) {
  revalidateEventWebsitePaths(orgSlug, event);
}
function fail(message: string): ActionResult {
  return { ok: false, error: message };
}

export async function uploadEventSpeakerPhoto(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (!(await isUserEmailVerified(session.user.id)))
    return {
      ok: false,
      error: "Verify your email before uploading speaker photos.",
    };
  if (await isActionRateLimited("upload", session.user.id))
    return { ok: false, error: "Too many uploads. Please try again later." };
  const parsed = target.safeParse({
    organisationSlug: formData.get("organisationSlug"),
    eventId: formData.get("eventId"),
  });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof File))
    return { ok: false, error: "Choose a speaker photo to upload." };
  if (file.size === 0 || file.size > MAX_SPEAKER_PHOTO_BYTES)
    return { ok: false, error: "Speaker photos must be 5 MB or smaller." };
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c)
    return {
      ok: false,
      error: "You do not have permission to upload speaker photos.",
    };
  try {
    const derivative = await createSafeWebpDerivative(file, {
      width: 1200,
      height: 1200,
      fit: "cover",
      position: "attention",
    });
    if ("error" in derivative) return { ok: false, error: derivative.error };
    const key = `organisations/${c.org.id}/event-speakers/${crypto.randomUUID()}.webp`;
    await uploadFile({
      key,
      body: derivative.body,
      contentType: "image/webp",
      organisationId: c.org.id,
    });
    await recordAuditEvent({
      action: "EVENT_SPEAKER_PHOTO_UPLOADED",
      actorUserId: session.user.id,
      organisationId: c.org.id,
      targetType: "Event",
      targetId: c.event.id,
    });
    return { ok: true, data: { url: getPublicUrl(key) } };
  } catch {
    return { ok: false, error: "Could not upload the speaker photo." };
  }
}

/** Sponsor logos follow the same validation, private storage, and WebP re-encoding path as speaker photos. */
export async function uploadEventSponsorLogo(
  formData: FormData,
): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (!(await isUserEmailVerified(session.user.id)))
    return {
      ok: false,
      error: "Verify your email before uploading sponsor logos.",
    };
  if (await isActionRateLimited("upload", session.user.id))
    return { ok: false, error: "Too many uploads. Please try again later." };
  const parsed = target.safeParse({
    organisationSlug: formData.get("organisationSlug"),
    eventId: formData.get("eventId"),
  });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof File))
    return { ok: false, error: "Choose a sponsor logo to upload." };
  if (file.size === 0 || file.size > MAX_SPEAKER_PHOTO_BYTES)
    return { ok: false, error: "Sponsor logos must be 5 MB or smaller." };
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c)
    return {
      ok: false,
      error: "You do not have permission to upload sponsor logos.",
    };
  try {
    const derivative = await createSafeWebpDerivative(file, {
      width: 1200,
      height: 1200,
      fit: "inside",
    });
    if ("error" in derivative) return { ok: false, error: derivative.error };
    const key = `organisations/${c.org.id}/event-sponsors/${crypto.randomUUID()}.webp`;
    await uploadFile({
      key,
      body: derivative.body,
      contentType: "image/webp",
      organisationId: c.org.id,
    });
    await recordAuditEvent({
      action: "EVENT_SPONSOR_LOGO_UPLOADED",
      actorUserId: session.user.id,
      organisationId: c.org.id,
      targetType: "Event",
      targetId: c.event.id,
    });
    return { ok: true, data: { url: getPublicUrl(key) } };
  } catch {
    return { ok: false, error: "Could not upload the sponsor logo." };
  }
}

export async function saveEventPage(input: unknown): Promise<ActionResult> {
  const schema = target
    .extend({
      tagline: z.string().trim().max(240).default(""),
      logoUrl: optionalImageUrl,
      accentColor: z
        .union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.literal("")])
        .optional(),
      aboutHtml: z.string().max(50_000).default(""),
      sections: z
        .array(
          z.object({
            type: z.nativeEnum(EventPageSectionType),
            isVisible: z.boolean(),
            sortOrder: z.number().int().min(0).max(20),
          }),
        )
        // Every section type once. A form opened before CREW existed still
        // sends the other nine, which leaves the saved CREW row untouched.
        .min(Object.values(EventPageSectionType).length - 1)
        .max(Object.values(EventPageSectionType).length)
        .refine((sections) => new Set(sections.map((section) => section.type)).size === sections.length),
    })
    .strict();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Invalid event page settings.");
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return fail("You do not have permission to edit this event page.");
  if (
    parsed.data.logoUrl &&
    !isOrganisationUploadUrl(parsed.data.logoUrl, c.org.id, "event-page-logos")
  )
    return fail("Choose an uploaded event page logo.");
  await prisma.$transaction(async (tx) => {
    const page = await tx.eventPage.upsert({
      where: { eventId: c.event.id },
      create: {
        eventId: c.event.id,
        // Website release follows the event's published status.
        isPublished: c.event.status === EventStatus.PUBLISHED,
        tagline: parsed.data.tagline,
        logoUrl: parsed.data.logoUrl || null,
        accentColor: parsed.data.accentColor || null,
        aboutHtml: sanitizeRichText(parsed.data.aboutHtml),
      },
      update: {
        tagline: parsed.data.tagline,
        logoUrl: parsed.data.logoUrl || null,
        accentColor: parsed.data.accentColor || null,
        aboutHtml: sanitizeRichText(parsed.data.aboutHtml),
      },
    });
    for (const section of parsed.data.sections)
      await tx.eventPageSection.upsert({
        where: { pageId_type: { pageId: page.id, type: section.type } },
        create: { pageId: page.id, ...section },
        update: { isVisible: section.isVisible, sortOrder: section.sortOrder },
      });
  });
  await recordAuditEvent({
    action: "EVENT_PAGE_UPDATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "Event",
    targetId: c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

/**
 * Switch on the public Crew section from Guests → Crew (docs/CREW.md), the
 * same change as turning it on in Event page → Sections and saving. Needs
 * EDIT_DETAILS like every page setting; a section already saved keeps its
 * place, a new one goes last.
 */
export async function showCrewSection(input: unknown): Promise<ActionResult> {
  const parsed = target.strict().safeParse(input);
  if (!parsed.success) return fail("Invalid event page settings.");
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return fail("You do not have permission to edit this event page.");
  await prisma.$transaction(async (tx) => {
    const page = await tx.eventPage.upsert({
      where: { eventId: c.event.id },
      // Website release follows the event's published status.
      create: { eventId: c.event.id, isPublished: c.event.status === EventStatus.PUBLISHED },
      update: {},
      select: { id: true },
    });
    const last = await tx.eventPageSection.aggregate({ where: { pageId: page.id }, _max: { sortOrder: true } });
    await tx.eventPageSection.upsert({
      where: { pageId_type: { pageId: page.id, type: EventPageSectionType.CREW } },
      create: { pageId: page.id, type: EventPageSectionType.CREW, isVisible: true, sortOrder: Math.min(20, (last._max.sortOrder ?? 8) + 1) },
      update: { isVisible: true },
    });
  });
  await recordAuditEvent({
    action: "EVENT_PAGE_UPDATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "Event",
    targetId: c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

const simpleContent = target.extend({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(""),
  visibility,
  sortOrder: z.number().int().min(0).max(10000).default(0),
});
export async function saveHighlight(input: unknown): Promise<ActionResult> {
  const parsed = simpleContent
    .extend({ icon: z.string().trim().max(40).optional().default("") })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid highlight.");
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return fail("You do not have permission to manage highlights.");
  const data = {
    title: parsed.data.title,
    description: parsed.data.description,
    icon: parsed.data.icon || null,
    visibility: parsed.data.visibility,
    sortOrder: parsed.data.sortOrder,
  };
  if (parsed.data.id)
    await prisma.eventHighlight.updateMany({
      where: { id: parsed.data.id, eventId: c.event.id },
      data,
    });
  else
    await prisma.eventHighlight.create({
      data: { eventId: c.event.id, ...data },
    });
  await recordAuditEvent({
    action: parsed.data.id ? "EVENT_HIGHLIGHT_UPDATED" : "EVENT_HIGHLIGHT_CREATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "EventHighlight",
    targetId: parsed.data.id ?? c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

export async function saveSpeaker(input: unknown): Promise<ActionResult> {
  const parsed = simpleContent
    .extend({
      headline: z.string().trim().max(200).default(""),
      organisation: z.string().trim().max(200).default(""),
      photoUrl: optionalImageUrl,
      websiteUrl: optionalUrl,
      linkedinUrl: optionalUrl,
      xUrl: optionalUrl,
      bioHtml: z.string().max(50_000).default(""),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid speaker.");
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return fail("You do not have permission to manage speakers.");
  if (
    parsed.data.photoUrl &&
    !isOrganisationUploadUrl(parsed.data.photoUrl, c.org.id, "event-speakers")
  )
    return fail("Choose an uploaded speaker photo.");
  const base = slugifyTitle(parsed.data.title);
  let slug = base;
  let n = 0;
  while (
    await prisma.eventSpeaker.findFirst({
      where: {
        eventId: c.event.id,
        slug,
        ...(parsed.data.id ? { id: { not: parsed.data.id } } : {}),
      },
      select: { id: true },
    })
  )
    slug = withSlugSuffix(base, ++n);
  const data = {
    name: parsed.data.title,
    slug,
    headline: parsed.data.headline,
    organisation: parsed.data.organisation,
    photoUrl: parsed.data.photoUrl || null,
    websiteUrl: parsed.data.websiteUrl || null,
    linkedinUrl: parsed.data.linkedinUrl || null,
    xUrl: parsed.data.xUrl || null,
    bioHtml: sanitizeRichText(parsed.data.bioHtml),
    visibility: parsed.data.visibility,
    sortOrder: parsed.data.sortOrder,
  };
  if (parsed.data.id)
    await prisma.eventSpeaker.updateMany({
      where: { id: parsed.data.id, eventId: c.event.id },
      data,
    });
  else
    await prisma.eventSpeaker.create({
      data: { eventId: c.event.id, ...data },
    });
  await recordAuditEvent({
    action: parsed.data.id ? "EVENT_SPEAKER_UPDATED" : "EVENT_SPEAKER_CREATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "EventSpeaker",
    targetId: parsed.data.id ?? c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

export async function saveSponsor(input: unknown): Promise<ActionResult> {
  const parsed = simpleContent
    .extend({
      logoUrl: optionalImageUrl,
      websiteUrl: optionalUrl,
      tier: z.nativeEnum(SponsorTier).default(SponsorTier.PARTNER),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid sponsor.");
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return fail("You do not have permission to manage sponsors.");
  if (
    parsed.data.logoUrl &&
    !isOrganisationUploadUrl(parsed.data.logoUrl, c.org.id, "event-sponsors")
  )
    return fail("Choose an uploaded sponsor logo.");
  const data = {
    name: parsed.data.title,
    description: parsed.data.description,
    logoUrl: parsed.data.logoUrl || null,
    websiteUrl: parsed.data.websiteUrl || null,
    tier: parsed.data.tier,
    visibility: parsed.data.visibility,
    sortOrder: parsed.data.sortOrder,
  };
  if (parsed.data.id)
    await prisma.eventSponsor.updateMany({
      where: { id: parsed.data.id, eventId: c.event.id },
      data,
    });
  else
    await prisma.eventSponsor.create({
      data: { eventId: c.event.id, ...data },
    });
  await recordAuditEvent({
    action: parsed.data.id ? "EVENT_SPONSOR_UPDATED" : "EVENT_SPONSOR_CREATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "EventSponsor",
    targetId: parsed.data.id ?? c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

export async function saveResource(input: unknown): Promise<ActionResult> {
  const parsed = simpleContent.extend({ externalUrl: http }).safeParse(input);
  if (!parsed.success) return fail("Invalid resource.");
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return fail("You do not have permission to manage resources.");
  const data = {
    title: parsed.data.title,
    description: parsed.data.description,
    externalUrl: parsed.data.externalUrl,
    assetKey: null,
    visibility: parsed.data.visibility,
    sortOrder: parsed.data.sortOrder,
  };
  if (parsed.data.id)
    await prisma.eventResource.updateMany({
      where: { id: parsed.data.id, eventId: c.event.id },
      data,
    });
  else
    await prisma.eventResource.create({
      data: { eventId: c.event.id, ...data },
    });
  await recordAuditEvent({
    action: parsed.data.id ? "EVENT_RESOURCE_UPDATED" : "EVENT_RESOURCE_CREATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "EventResource",
    targetId: parsed.data.id ?? c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

export async function saveFaq(input: unknown): Promise<ActionResult> {
  const parsed = target
    .extend({
      id: z.string().min(1).optional(),
      question: z.string().trim().min(1).max(400),
      answerHtml: z.string().max(50_000),
      visibility,
      sortOrder: z.number().int().min(0).max(10000).default(0),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid FAQ.");
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return fail("You do not have permission to manage FAQs.");
  const data = {
    question: parsed.data.question,
    answerHtml: sanitizeRichText(parsed.data.answerHtml),
    visibility: parsed.data.visibility,
    sortOrder: parsed.data.sortOrder,
  };
  if (parsed.data.id)
    await prisma.eventFaq.updateMany({
      where: { id: parsed.data.id, eventId: c.event.id },
      data,
    });
  else await prisma.eventFaq.create({ data: { eventId: c.event.id, ...data } });
  await recordAuditEvent({
    action: parsed.data.id ? "EVENT_FAQ_UPDATED" : "EVENT_FAQ_CREATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "EventFaq",
    targetId: parsed.data.id ?? c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

export async function saveVenue(input: unknown): Promise<ActionResult> {
  const parsed = target
    .extend({
      name: z.string().trim().min(1).max(200),
      address: z.string().trim().max(500).default(""),
      city: z.string().trim().max(120).default(""),
      country: z.string().trim().max(120).default(""),
      mapLinkUrl: optionalUrl,
      directions: z.string().trim().max(4000).default(""),
      parkingInfo: z.string().trim().max(4000).default(""),
      publicTransport: z.string().trim().max(4000).default(""),
      accessibilityInfo: z.string().trim().max(4000).default(""),
      visibility,
      rooms: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid venue.");
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return fail("You do not have permission to manage the venue.");
  const venueData = {
    name: parsed.data.name,
    address: parsed.data.address,
    city: parsed.data.city,
    country: parsed.data.country,
    mapLinkUrl: parsed.data.mapLinkUrl || null,
    directions: parsed.data.directions,
    parkingInfo: parsed.data.parkingInfo,
    publicTransport: parsed.data.publicTransport,
    accessibilityInfo: parsed.data.accessibilityInfo,
    visibility: parsed.data.visibility,
  };
  await prisma.$transaction(async (tx) => {
    const venue = await tx.eventVenue.upsert({
      where: { eventId: c.event.id },
      create: { eventId: c.event.id, ...venueData },
      update: venueData,
    });
    await tx.eventVenueRoom.deleteMany({
      where: { venueId: venue.id, name: { notIn: parsed.data.rooms } },
    });
    for (const [sortOrder, name] of parsed.data.rooms.entries())
      await tx.eventVenueRoom.upsert({
        where: { venueId_name: { venueId: venue.id, name } },
        create: { venueId: venue.id, name, sortOrder },
        update: { sortOrder },
      });
  });
  await recordAuditEvent({
    action: "EVENT_VENUE_UPDATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "Event",
    targetId: c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

const scheduleTrackSchema = target
  .extend({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export async function saveScheduleTrack(input: unknown): Promise<ActionResult> {
  const parsed = scheduleTrackSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a track name.");
  const c = await context(parsed.data, EventPermission.PUBLISH_AND_SCHEDULE);
  if (!c) return fail("You do not have permission to manage programme tracks.");
  try {
    if (parsed.data.id) {
      const updated = await prisma.eventScheduleTrack.updateMany({
        where: { id: parsed.data.id, eventId: c.event.id },
        data: { name: parsed.data.name },
      });
      if (!updated.count) return fail("Track not found.");
    } else {
      const lastTrack = await prisma.eventScheduleTrack.findFirst({
        where: { eventId: c.event.id },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      await prisma.eventScheduleTrack.create({
        data: {
          eventId: c.event.id,
          name: parsed.data.name,
          sortOrder: (lastTrack?.sortOrder ?? -1) + 1,
        },
      });
    }
  } catch {
    return fail("A track with that name already exists.");
  }
  await recordAuditEvent({
    action: parsed.data.id ? "EVENT_SCHEDULE_TRACK_UPDATED" : "EVENT_SCHEDULE_TRACK_CREATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "EventScheduleTrack",
    targetId: parsed.data.id ?? c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

export async function deleteScheduleTrack(input: unknown): Promise<ActionResult> {
  const parsed = target.extend({ trackId: z.string().min(1) }).strict().safeParse(input);
  if (!parsed.success) return fail("Invalid programme track.");
  const c = await context(parsed.data, EventPermission.PUBLISH_AND_SCHEDULE);
  if (!c) return fail("You do not have permission to manage programme tracks.");
  const track = await prisma.eventScheduleTrack.findFirst({
    where: { id: parsed.data.trackId, eventId: c.event.id },
    select: { id: true, _count: { select: { sessions: true } } },
  });
  if (!track) return fail("Track not found.");
  if (track._count.sessions) return fail("Move or remove this track's sessions before deleting it.");
  await prisma.eventScheduleTrack.delete({ where: { id: track.id } });
  await recordAuditEvent({
    action: "EVENT_SCHEDULE_TRACK_DELETED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "EventScheduleTrack",
    targetId: track.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

export async function reorderScheduleTracks(input: unknown): Promise<ActionResult> {
  const parsed = target
    .extend({ trackIds: z.array(z.string().min(1)).min(1).max(60) })
    .strict()
    .safeParse(input);
  if (!parsed.success || new Set(parsed.data.trackIds).size !== parsed.data.trackIds.length)
    return fail("Invalid programme track order.");
  const c = await context(parsed.data, EventPermission.PUBLISH_AND_SCHEDULE);
  if (!c) return fail("You do not have permission to manage programme tracks.");
  const tracks = await prisma.eventScheduleTrack.findMany({
    where: { eventId: c.event.id, id: { in: parsed.data.trackIds } },
    select: { id: true },
  });
  if (tracks.length !== parsed.data.trackIds.length)
    return fail("One or more tracks do not belong to this event.");
  await prisma.$transaction(
    parsed.data.trackIds.map((id, sortOrder) =>
      prisma.eventScheduleTrack.update({ where: { id }, data: { sortOrder } }),
    ),
  );
  await recordAuditEvent({
    action: "EVENT_SCHEDULE_TRACKS_REORDERED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "Event",
    targetId: c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}

const sessionFail = (error: string): ActionResult<{ conflictingSessions: Array<{ id: string; title: string }> }> => ({ ok: false, error });

export async function saveSession(
  input: unknown,
): Promise<ActionResult<{ conflictingSessions: Array<{ id: string; title: string }> }>> {
  const parsed = target
    .extend({
      id: z.string().min(1).optional(),
      title: z.string().trim().min(1).max(200),
      descriptionHtml: z.string().max(50_000).default(""),
      startDateTime: z.coerce.date(),
      endDateTime: z.coerce.date(),
      type: z.string().trim().min(1).max(60),
      trackId: z.string().min(1),
      speakerIds: z.array(z.string().min(1)).max(50).default([]),
      visibility,
      sortOrder: z.number().int().min(0).max(10000).default(0),
    })
    .refine((v) => v.endDateTime > v.startDateTime, {
      message: "End must be after start.",
    })
    .safeParse(input);
  if (!parsed.success) return sessionFail("Invalid session.");
  const c = await context(parsed.data, EventPermission.PUBLISH_AND_SCHEDULE);
  if (!c) return sessionFail("You do not have permission to manage the program.");
  const track = await prisma.eventScheduleTrack.findFirst({
    where: { id: parsed.data.trackId, eventId: c.event.id },
    select: { id: true },
  });
  if (!track) return sessionFail("Choose a track belonging to this event.");
  const speakerCount = await prisma.eventSpeaker.count({
    where: { id: { in: parsed.data.speakerIds }, eventId: c.event.id },
  });
  if (speakerCount !== parsed.data.speakerIds.length)
    return sessionFail("One or more speakers do not belong to this event.");
  const base = slugifyTitle(parsed.data.title);
  let slug = base;
  let n = 0;
  while (
    await prisma.eventSession.findFirst({
      where: {
        eventId: c.event.id,
        slug,
        ...(parsed.data.id ? { id: { not: parsed.data.id } } : {}),
      },
      select: { id: true },
    })
  )
    slug = withSlugSuffix(base, ++n);
  const data = {
    title: parsed.data.title,
    slug,
    descriptionHtml: sanitizeRichText(parsed.data.descriptionHtml),
    startDateTime: parsed.data.startDateTime,
    endDateTime: parsed.data.endDateTime,
    type: parsed.data.type,
    trackId: track.id,
    visibility: parsed.data.visibility,
    sortOrder: parsed.data.sortOrder,
  };
  if (
    parsed.data.id &&
    !(await prisma.eventSession.findFirst({
      where: { id: parsed.data.id, eventId: c.event.id },
      select: { id: true },
    }))
  )
    return sessionFail("Session not found.");
  const savedSession = await prisma.$transaction(async (tx) => {
    const session = parsed.data.id
      ? await tx.eventSession.update({ where: { id: parsed.data.id }, data })
      : await tx.eventSession.create({
          data: { eventId: c.event.id, ...data },
        });
    await tx.eventSessionSpeaker.deleteMany({
      where: { eventSessionId: session.id },
    });
    if (parsed.data.speakerIds.length)
      await tx.eventSessionSpeaker.createMany({
        data: parsed.data.speakerIds.map((speakerId, sortOrder) => ({
          eventSessionId: session.id,
          speakerId,
          sortOrder,
      })),
    });
    return session;
  });
  const conflicts = await prisma.eventSession.findMany({
    where: {
      eventId: c.event.id,
      trackId: track.id,
      id: { not: savedSession.id },
      startDateTime: { lt: parsed.data.endDateTime },
      endDateTime: { gt: parsed.data.startDateTime },
    },
    select: { id: true, title: true },
  });
  await recordAuditEvent({
    action: parsed.data.id ? "EVENT_SESSION_UPDATED" : "EVENT_SESSION_CREATED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: "EventSession",
    targetId: parsed.data.id ?? c.event.id,
  });
  paths(c.org.slug, c.event);
  return { ok: true, data: { conflictingSessions: conflicts } };
}

export async function setEventSessionDelay(
  input: unknown,
): Promise<ActionResult> {
  // Shared with the mobile API (lib/core/eventProgramme.ts).
  const session = await auth();
  return setEventSessionDelayForUser(session?.user?.id ?? null, input);
}

export async function deleteWebsiteContent(
  input: unknown,
): Promise<ActionResult> {
  const parsed = target
    .extend({
      kind: z.enum([
        "highlight",
        "speaker",
        "sponsor",
        "resource",
        "faq",
        "session",
      ]),
      id: z.string().min(1),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid delete request.");
  const permission =
    parsed.data.kind === "session"
      ? EventPermission.PUBLISH_AND_SCHEDULE
      : EventPermission.EDIT_DETAILS;
  const c = await context(parsed.data, permission);
  if (!c) return fail("You do not have permission to delete this content.");
  const where = { id: parsed.data.id, eventId: c.event.id };
  if (parsed.data.kind === "highlight")
    await prisma.eventHighlight.deleteMany({ where });
  if (parsed.data.kind === "speaker")
    await prisma.eventSpeaker.deleteMany({ where });
  if (parsed.data.kind === "sponsor")
    await prisma.eventSponsor.deleteMany({ where });
  if (parsed.data.kind === "resource")
    await prisma.eventResource.deleteMany({ where });
  if (parsed.data.kind === "faq") await prisma.eventFaq.deleteMany({ where });
  if (parsed.data.kind === "session")
    await prisma.eventSession.deleteMany({ where });
  await recordAuditEvent({
    action: "EVENT_PAGE_CONTENT_DELETED",
    actorUserId: c.session.user.id,
    organisationId: c.org.id,
    targetType: parsed.data.kind,
    targetId: parsed.data.id,
    metadata: { kind: parsed.data.kind },
  });
  paths(c.org.slug, c.event);
  return { ok: true };
}
