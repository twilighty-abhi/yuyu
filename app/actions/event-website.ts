"use server";

import { ContentVisibility, EventPageSectionType, EventPermission, EventSessionType, SponsorTier } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessEvent } from "@/lib/eventAccess";
import { isUserEmailVerified } from "@/lib/permissions";
import { slugifyTitle, withSlugSuffix } from "@/lib/slug";
import { sanitizeRichText } from "@/lib/richText";
import { recordAuditEvent } from "@/lib/audit";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { createSafeWebpDerivative } from "@/lib/imageValidation";
import { getPublicUrl, uploadFile } from "@/lib/storage";
import type { ActionResult } from "./org";

const http = z.string().url().refine((value) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}, "Use an HTTP(S) URL");
const optionalUrl = z.union([http, z.literal("")]).optional();
// Safe derivatives use an application-relative delivery URL in local/self-hosted
// setups where NEXT_PUBLIC_BASE_URL is intentionally not configured.
const optionalImageUrl = z.union([http, z.string().regex(/^\/api\/uploads\//), z.literal("")]).optional();
const target = z.object({ organisationSlug: z.string().min(1), eventId: z.string().min(1) });
const visibility = z.nativeEnum(ContentVisibility).default(ContentVisibility.DRAFT);
const MAX_SPEAKER_PHOTO_BYTES = 5 * 1024 * 1024;

async function context(input: z.infer<typeof target>, permission: EventPermission) {
  const session = await auth();
  if (!session?.user?.id) return null;
  if (await isActionRateLimited("action", session.user.id)) return null;
  const org = await prisma.organisation.findUnique({ where: { slug: input.organisationSlug } });
  if (!org || !(await canAccessEvent({ userId: session.user.id, organisationId: org.id, eventId: input.eventId, permission }))) return null;
  const event = await prisma.event.findFirst({ where: { id: input.eventId, organisationId: org.id }, select: { id: true, slug: true } });
  return event ? { session, org, event } : null;
}
function paths(orgSlug: string, event: { id: string; slug: string }) {
  revalidatePath(`/${orgSlug}/${event.slug}`);
  revalidatePath(`/${orgSlug}/${event.slug}/schedule`);
  revalidatePath(`/dashboard/${orgSlug}/event/${event.id}`);
  revalidatePath(`/dashboard/${orgSlug}/event/${event.id}/schedule`);
}
function fail(message: string): ActionResult { return { ok: false, error: message }; }

export async function uploadEventSpeakerPhoto(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (!(await isUserEmailVerified(session.user.id))) return { ok: false, error: "Verify your email before uploading speaker photos." };
  if (await isActionRateLimited("upload", session.user.id)) return { ok: false, error: "Too many uploads. Please try again later." };
  const parsed = target.safeParse({ organisationSlug: formData.get("organisationSlug"), eventId: formData.get("eventId") });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof File)) return { ok: false, error: "Choose a speaker photo to upload." };
  if (file.size === 0 || file.size > MAX_SPEAKER_PHOTO_BYTES) return { ok: false, error: "Speaker photos must be 5 MB or smaller." };
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return { ok: false, error: "You do not have permission to upload speaker photos." };
  try {
    const derivative = await createSafeWebpDerivative(file, { width: 1200, height: 1200, fit: "cover", position: "attention" });
    if ("error" in derivative) return { ok: false, error: derivative.error };
    const key = `organisations/${c.org.id}/event-speakers/${crypto.randomUUID()}.webp`;
    await uploadFile({ key, body: derivative.body, contentType: "image/webp", organisationId: c.org.id });
    await recordAuditEvent({ action: "EVENT_SPEAKER_PHOTO_UPLOADED", actorUserId: session.user.id, organisationId: c.org.id, targetType: "Event", targetId: c.event.id });
    return { ok: true, data: { url: getPublicUrl(key) } };
  } catch {
    return { ok: false, error: "Could not upload the speaker photo." };
  }
}

/** Sponsor logos follow the same validation, private storage, and WebP re-encoding path as speaker photos. */
export async function uploadEventSponsorLogo(formData: FormData): Promise<ActionResult<{ url: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "You must be signed in." };
  if (!(await isUserEmailVerified(session.user.id))) return { ok: false, error: "Verify your email before uploading sponsor logos." };
  if (await isActionRateLimited("upload", session.user.id)) return { ok: false, error: "Too many uploads. Please try again later." };
  const parsed = target.safeParse({ organisationSlug: formData.get("organisationSlug"), eventId: formData.get("eventId") });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof File)) return { ok: false, error: "Choose a sponsor logo to upload." };
  if (file.size === 0 || file.size > MAX_SPEAKER_PHOTO_BYTES) return { ok: false, error: "Sponsor logos must be 5 MB or smaller." };
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS);
  if (!c) return { ok: false, error: "You do not have permission to upload sponsor logos." };
  try {
    const derivative = await createSafeWebpDerivative(file, { width: 1200, height: 1200, fit: "inside" });
    if ("error" in derivative) return { ok: false, error: derivative.error };
    const key = `organisations/${c.org.id}/event-sponsors/${crypto.randomUUID()}.webp`;
    await uploadFile({ key, body: derivative.body, contentType: "image/webp", organisationId: c.org.id });
    await recordAuditEvent({ action: "EVENT_SPONSOR_LOGO_UPLOADED", actorUserId: session.user.id, organisationId: c.org.id, targetType: "Event", targetId: c.event.id });
    return { ok: true, data: { url: getPublicUrl(key) } };
  } catch {
    return { ok: false, error: "Could not upload the sponsor logo." };
  }
}

export async function setEventPagePublished(input: unknown): Promise<ActionResult> {
  const parsed = target.extend({ isPublished: z.boolean() }).safeParse(input);
  if (!parsed.success) return fail("Invalid event website release request.");
  const c = await context(parsed.data, EventPermission.PUBLISH_AND_SCHEDULE);
  if (!c) return fail("You do not have permission to release this event website.");
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${c.event.id} FOR UPDATE`;
    await tx.eventPage.upsert({ where: { eventId: c.event.id }, create: { eventId: c.event.id, isPublished: parsed.data.isPublished }, update: { isPublished: parsed.data.isPublished } });
  });
  await recordAuditEvent({ action: parsed.data.isPublished ? "EVENT_PAGE_PUBLISHED" : "EVENT_PAGE_UNPUBLISHED", actorUserId: c.session.user.id, organisationId: c.org.id, targetType: "Event", targetId: c.event.id });
  paths(c.org.slug, c.event);
  return { ok: true };
}

export async function saveEventPage(input: unknown): Promise<ActionResult> {
  const schema = target.extend({ tagline: z.string().trim().max(240).default(""), logoUrl: optionalUrl, accentColor: z.union([z.string().regex(/^#[0-9a-fA-F]{6}$/), z.literal("")]).optional(), aboutHtml: z.string().max(50_000).default(""), sections: z.array(z.object({ type: z.nativeEnum(EventPageSectionType), isVisible: z.boolean(), sortOrder: z.number().int().min(0).max(20) })).length(9) }).strict();
  const parsed = schema.safeParse(input); if (!parsed.success) return fail("Invalid event page settings.");
  const c = await context(parsed.data, EventPermission.EDIT_DETAILS); if (!c) return fail("You do not have permission to edit this event page.");
  await prisma.$transaction(async (tx) => {
    const page = await tx.eventPage.upsert({ where: { eventId: c.event.id }, create: { eventId: c.event.id, isPublished: false, tagline: parsed.data.tagline, logoUrl: parsed.data.logoUrl || null, accentColor: parsed.data.accentColor || null, aboutHtml: sanitizeRichText(parsed.data.aboutHtml) }, update: { tagline: parsed.data.tagline, logoUrl: parsed.data.logoUrl || null, accentColor: parsed.data.accentColor || null, aboutHtml: sanitizeRichText(parsed.data.aboutHtml) } });
    for (const section of parsed.data.sections) await tx.eventPageSection.upsert({ where: { pageId_type: { pageId: page.id, type: section.type } }, create: { pageId: page.id, ...section }, update: { isVisible: section.isVisible, sortOrder: section.sortOrder } });
  });
  await recordAuditEvent({ action: "EVENT_PAGE_UPDATED", actorUserId: c.session.user.id, organisationId: c.org.id, targetType: "Event", targetId: c.event.id }); paths(c.org.slug, c.event); return { ok: true };
}

const simpleContent = target.extend({ id: z.string().min(1).optional(), title: z.string().trim().min(1).max(200), description: z.string().trim().max(4000).default(""), visibility, sortOrder: z.number().int().min(0).max(10000).default(0) });
export async function saveHighlight(input: unknown): Promise<ActionResult> {
  const parsed = simpleContent.extend({ icon: z.string().trim().max(40).optional().default("") }).safeParse(input); if (!parsed.success) return fail("Invalid highlight."); const c = await context(parsed.data, EventPermission.EDIT_DETAILS); if (!c) return fail("You do not have permission to manage highlights.");
  const data = { title: parsed.data.title, description: parsed.data.description, icon: parsed.data.icon || null, visibility: parsed.data.visibility, sortOrder: parsed.data.sortOrder };
  if (parsed.data.id) await prisma.eventHighlight.updateMany({ where: { id: parsed.data.id, eventId: c.event.id }, data }); else await prisma.eventHighlight.create({ data: { eventId: c.event.id, ...data } }); paths(c.org.slug, c.event); return { ok: true };
}

export async function saveSpeaker(input: unknown): Promise<ActionResult> {
  const parsed = simpleContent.extend({ headline: z.string().trim().max(200).default(""), organisation: z.string().trim().max(200).default(""), photoUrl: optionalImageUrl, websiteUrl: optionalUrl, linkedinUrl: optionalUrl, xUrl: optionalUrl, bioHtml: z.string().max(50_000).default("") }).safeParse(input); if (!parsed.success) return fail("Invalid speaker."); const c = await context(parsed.data, EventPermission.EDIT_DETAILS); if (!c) return fail("You do not have permission to manage speakers.");
  const base = slugifyTitle(parsed.data.title); let slug = base; let n = 0; while (await prisma.eventSpeaker.findFirst({ where: { eventId: c.event.id, slug, ...(parsed.data.id ? { id: { not: parsed.data.id } } : {}) }, select: { id: true } })) slug = withSlugSuffix(base, ++n);
  const data = { name: parsed.data.title, slug, headline: parsed.data.headline, organisation: parsed.data.organisation, photoUrl: parsed.data.photoUrl || null, websiteUrl: parsed.data.websiteUrl || null, linkedinUrl: parsed.data.linkedinUrl || null, xUrl: parsed.data.xUrl || null, bioHtml: sanitizeRichText(parsed.data.bioHtml), visibility: parsed.data.visibility, sortOrder: parsed.data.sortOrder };
  if (parsed.data.id) await prisma.eventSpeaker.updateMany({ where: { id: parsed.data.id, eventId: c.event.id }, data }); else await prisma.eventSpeaker.create({ data: { eventId: c.event.id, ...data } }); paths(c.org.slug, c.event); return { ok: true };
}

export async function saveSponsor(input: unknown): Promise<ActionResult> {
  const parsed = simpleContent.extend({ logoUrl: optionalImageUrl, websiteUrl: optionalUrl, tier: z.nativeEnum(SponsorTier).default(SponsorTier.PARTNER) }).safeParse(input); if (!parsed.success) return fail("Invalid sponsor."); const c = await context(parsed.data, EventPermission.EDIT_DETAILS); if (!c) return fail("You do not have permission to manage sponsors.");
  const data = { name: parsed.data.title, description: parsed.data.description, logoUrl: parsed.data.logoUrl || null, websiteUrl: parsed.data.websiteUrl || null, tier: parsed.data.tier, visibility: parsed.data.visibility, sortOrder: parsed.data.sortOrder };
  if (parsed.data.id) await prisma.eventSponsor.updateMany({ where: { id: parsed.data.id, eventId: c.event.id }, data }); else await prisma.eventSponsor.create({ data: { eventId: c.event.id, ...data } }); paths(c.org.slug, c.event); return { ok: true };
}

export async function saveResource(input: unknown): Promise<ActionResult> {
  const parsed = simpleContent.extend({ externalUrl: http }).safeParse(input); if (!parsed.success) return fail("Invalid resource."); const c = await context(parsed.data, EventPermission.EDIT_DETAILS); if (!c) return fail("You do not have permission to manage resources.");
  const data = { title: parsed.data.title, description: parsed.data.description, externalUrl: parsed.data.externalUrl, assetKey: null, visibility: parsed.data.visibility, sortOrder: parsed.data.sortOrder };
  if (parsed.data.id) await prisma.eventResource.updateMany({ where: { id: parsed.data.id, eventId: c.event.id }, data }); else await prisma.eventResource.create({ data: { eventId: c.event.id, ...data } }); paths(c.org.slug, c.event); return { ok: true };
}

export async function saveFaq(input: unknown): Promise<ActionResult> {
  const parsed = target.extend({ id: z.string().min(1).optional(), question: z.string().trim().min(1).max(400), answerHtml: z.string().max(50_000), visibility, sortOrder: z.number().int().min(0).max(10000).default(0) }).safeParse(input); if (!parsed.success) return fail("Invalid FAQ."); const c = await context(parsed.data, EventPermission.EDIT_DETAILS); if (!c) return fail("You do not have permission to manage FAQs.");
  const data = { question: parsed.data.question, answerHtml: sanitizeRichText(parsed.data.answerHtml), visibility: parsed.data.visibility, sortOrder: parsed.data.sortOrder };
  if (parsed.data.id) await prisma.eventFaq.updateMany({ where: { id: parsed.data.id, eventId: c.event.id }, data }); else await prisma.eventFaq.create({ data: { eventId: c.event.id, ...data } }); paths(c.org.slug, c.event); return { ok: true };
}

export async function saveVenue(input: unknown): Promise<ActionResult> {
  const parsed = target.extend({ name: z.string().trim().min(1).max(200), address: z.string().trim().max(500).default(""), city: z.string().trim().max(120).default(""), country: z.string().trim().max(120).default(""), mapLinkUrl: optionalUrl, directions: z.string().trim().max(4000).default(""), parkingInfo: z.string().trim().max(4000).default(""), publicTransport: z.string().trim().max(4000).default(""), accessibilityInfo: z.string().trim().max(4000).default(""), visibility, rooms: z.array(z.string().trim().min(1).max(120)).max(30).default([]) }).safeParse(input); if (!parsed.success) return fail("Invalid venue."); const c = await context(parsed.data, EventPermission.EDIT_DETAILS); if (!c) return fail("You do not have permission to manage the venue.");
  const venueData = { name: parsed.data.name, address: parsed.data.address, city: parsed.data.city, country: parsed.data.country, mapLinkUrl: parsed.data.mapLinkUrl || null, directions: parsed.data.directions, parkingInfo: parsed.data.parkingInfo, publicTransport: parsed.data.publicTransport, accessibilityInfo: parsed.data.accessibilityInfo, visibility: parsed.data.visibility };
  await prisma.$transaction(async (tx) => { const venue = await tx.eventVenue.upsert({ where: { eventId: c.event.id }, create: { eventId: c.event.id, ...venueData }, update: venueData }); await tx.eventVenueRoom.deleteMany({ where: { venueId: venue.id, sessions: { none: {} } } }); for (const [sortOrder, name] of parsed.data.rooms.entries()) await tx.eventVenueRoom.upsert({ where: { venueId_name: { venueId: venue.id, name } }, create: { venueId: venue.id, name, sortOrder }, update: { sortOrder } }); }); paths(c.org.slug, c.event); return { ok: true };
}

export async function saveSession(input: unknown): Promise<ActionResult> {
  const parsed = target.extend({ id: z.string().min(1).optional(), title: z.string().trim().min(1).max(200), descriptionHtml: z.string().max(50_000).default(""), startDateTime: z.coerce.date(), endDateTime: z.coerce.date(), type: z.nativeEnum(EventSessionType), track: z.string().trim().max(100).default(""), roomId: z.string().min(1).optional().or(z.literal("")), speakerIds: z.array(z.string().min(1)).max(50).default([]), visibility, sortOrder: z.number().int().min(0).max(10000).default(0) }).refine((v) => v.endDateTime > v.startDateTime, { message: "End must be after start." }).safeParse(input); if (!parsed.success) return fail("Invalid session."); const c = await context(parsed.data, EventPermission.PUBLISH_AND_SCHEDULE); if (!c) return fail("You do not have permission to manage the program.");
  if (parsed.data.roomId && !(await prisma.eventVenueRoom.findFirst({ where: { id: parsed.data.roomId, venue: { eventId: c.event.id } }, select: { id: true } }))) return fail("Room not found.");
  const speakerCount = await prisma.eventSpeaker.count({ where: { id: { in: parsed.data.speakerIds }, eventId: c.event.id } }); if (speakerCount !== parsed.data.speakerIds.length) return fail("One or more speakers do not belong to this event.");
  const base = slugifyTitle(parsed.data.title); let slug = base; let n = 0; while (await prisma.eventSession.findFirst({ where: { eventId: c.event.id, slug, ...(parsed.data.id ? { id: { not: parsed.data.id } } : {}) }, select: { id: true } })) slug = withSlugSuffix(base, ++n);
  const data = { title: parsed.data.title, slug, descriptionHtml: sanitizeRichText(parsed.data.descriptionHtml), startDateTime: parsed.data.startDateTime, endDateTime: parsed.data.endDateTime, type: parsed.data.type, track: parsed.data.track || null, roomId: parsed.data.roomId || null, visibility: parsed.data.visibility, sortOrder: parsed.data.sortOrder };
  if (parsed.data.id && !(await prisma.eventSession.findFirst({ where: { id: parsed.data.id, eventId: c.event.id }, select: { id: true } }))) return fail("Session not found.");
  await prisma.$transaction(async (tx) => {
    const session = parsed.data.id ? await tx.eventSession.update({ where: { id: parsed.data.id }, data }) : await tx.eventSession.create({ data: { eventId: c.event.id, ...data } });
    await tx.eventSessionSpeaker.deleteMany({ where: { eventSessionId: session.id } });
    if (parsed.data.speakerIds.length) await tx.eventSessionSpeaker.createMany({ data: parsed.data.speakerIds.map((speakerId, sortOrder) => ({ eventSessionId: session.id, speakerId, sortOrder })) });
  });
  paths(c.org.slug, c.event); return { ok: true };
}

export async function setEventSessionDelay(input: unknown): Promise<ActionResult> {
  const parsed = target.extend({ sessionId: z.string().min(1), delayMinutes: z.number().int().min(0).max(1440) }).safeParse(input);
  if (!parsed.success) return fail("Invalid programme delay.");
  const c = await context(parsed.data, EventPermission.PUBLISH_AND_SCHEDULE);
  if (!c) return fail("You do not have permission to manage the programme.");
  const result = await prisma.eventSession.updateMany({ where: { id: parsed.data.sessionId, eventId: c.event.id }, data: { delayMinutes: parsed.data.delayMinutes } });
  if (!result.count) return fail("Session not found.");
  const session = await prisma.eventSession.findFirst({ where: { id: parsed.data.sessionId, eventId: c.event.id }, select: { slug: true } });
  await recordAuditEvent({ action: "EVENT_SESSION_DELAY_SET", actorUserId: c.session.user.id, organisationId: c.org.id, targetType: "EventSession", targetId: parsed.data.sessionId, metadata: { delayMinutes: parsed.data.delayMinutes } });
  paths(c.org.slug, c.event);
  if (session) revalidatePath(`/${c.org.slug}/${c.event.slug}/sessions/${session.slug}`);
  return { ok: true };
}

export async function deleteWebsiteContent(input: unknown): Promise<ActionResult> {
  const parsed = target.extend({ kind: z.enum(["highlight", "speaker", "sponsor", "resource", "faq", "session"]), id: z.string().min(1) }).safeParse(input); if (!parsed.success) return fail("Invalid delete request."); const permission = parsed.data.kind === "session" ? EventPermission.PUBLISH_AND_SCHEDULE : EventPermission.EDIT_DETAILS; const c = await context(parsed.data, permission); if (!c) return fail("You do not have permission to delete this content.");
  const where = { id: parsed.data.id, eventId: c.event.id }; if (parsed.data.kind === "highlight") await prisma.eventHighlight.deleteMany({ where }); if (parsed.data.kind === "speaker") await prisma.eventSpeaker.deleteMany({ where }); if (parsed.data.kind === "sponsor") await prisma.eventSponsor.deleteMany({ where }); if (parsed.data.kind === "resource") await prisma.eventResource.deleteMany({ where }); if (parsed.data.kind === "faq") await prisma.eventFaq.deleteMany({ where }); if (parsed.data.kind === "session") await prisma.eventSession.deleteMany({ where }); paths(c.org.slug, c.event); return { ok: true };
}
