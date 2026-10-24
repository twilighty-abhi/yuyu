import "server-only";

import { ContentVisibility, EventPrivacyType, EventStatus, RsvpStatus, type Prisma } from "@prisma/client";
import { decodeCursor, encodeCursor } from "@/lib/api/v1/pagination";
import { prisma } from "@/lib/db";
import { effectiveEventProgram } from "@/lib/eventProgram";
import { listedEventAudienceWhere } from "@/lib/eventVisibility";
import { resolvePublicEventAccessForUser } from "@/lib/publicEventAccess";
import { registrationClosedReason } from "@/lib/core/registrationWindow";
import { countConfirmedForEvent } from "@/lib/rsvpCapacity";
import { absoluteUrl, eventSummarySelect, toEventSummary, toRegistrationField } from "@/lib/mobile/dto";
import { eventListDtoSchema, feedbackFormDtoSchema, publicEventDtoSchema } from "@/lib/mobile/schemas";

/* Public (anonymous-capable) event reads for the mobile apps. */

/** Discover: published, publicly listed standalone events with a released page that have not ended. */
export async function listDiscoverEvents(params: { limit: number; cursor?: string; baseUrl: string; now?: Date }) {
  const cursor = decodeCursor(params.cursor);
  if (params.cursor && !cursor) return null;
  const now = params.now ?? new Date();
  const where: Prisma.EventWhereInput = {
    status: EventStatus.PUBLISHED,
    AND: [
      listedEventAudienceWhere,
      ...(cursor ? [{
        OR: [
          { startDateTime: { gt: new Date(cursor.timestamp) } },
          { startDateTime: new Date(cursor.timestamp), id: { gt: cursor.id } },
        ],
      }] : []),
    ],
    page: { is: { isPublished: true } },
    endDateTime: { gte: now },
  };
  const rows = await prisma.event.findMany({
    where,
    select: eventSummarySelect,
    orderBy: [{ startDateTime: "asc" }, { id: "asc" }],
    take: params.limit + 1,
  });
  const page = rows.slice(0, params.limit);
  const last = page.at(-1);
  return eventListDtoSchema.parse({
    events: page.map((event) => toEventSummary(event, params.baseUrl)),
    nextCursor: rows.length > params.limit && last ? encodeCursor(last.startDateTime, last.id) : null,
  });
}

/** Search: the same predicate and cap as GET /api/search. */
export async function searchPublicEvents(q: string, baseUrl: string) {
  const qLower = q.toLowerCase();
  const tokens = Array.from(new Set(qLower.split(/[\s,]+/g).map((t) => t.trim()).filter((t) => t.length >= 2))).slice(0, 8);
  const events = await prisma.event.findMany({
    where: {
      status: EventStatus.PUBLISHED,
      AND: listedEventAudienceWhere,
      page: { is: { isPublished: true } },
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { tags: { has: qLower } },
        ...(tokens.length > 0 ? [{ tags: { hasSome: tokens } }] : []),
        { organisation: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    select: eventSummarySelect,
    orderBy: { startDateTime: "asc" },
    take: 48,
  });
  return eventListDtoSchema.parse({ events: events.map((event) => toEventSummary(event, baseUrl)), nextCursor: null });
}

/**
 * The public event page as data, with the same access rule as
 * /:orgSlug/:eventSlug (`resolvePublicEventAccess`). Only PUBLISHED website
 * content is returned, even to organisers who could preview a draft.
 */
export async function loadPublicEvent(params: { orgSlug: string; eventSlug: string; viewerUserId: string | null; baseUrl: string }) {
  const org = await prisma.organisation.findUnique({ where: { slug: params.orgSlug }, select: { id: true } });
  if (!org) return null;
  const event = await prisma.event.findUnique({
    where: { organisationId_slug: { organisationId: org.id, slug: params.eventSlug } },
    select: {
      ...eventSummarySelect,
      description: true,
      tags: true,
      capacity: true,
      showRegistrationCount: true,
      privacyType: true,
      registrationClosesAt: true,
      registrationLeadMinutes: true,
      registrationMode: true,
      page: { select: { accentColor: true, isPublished: true } },
      feedbackForm: { select: { isOpen: true } },
    },
  });
  if (!event) return null;
  const access = await resolvePublicEventAccessForUser(params.viewerUserId, {
    organisationId: org.id,
    eventId: event.id,
    status: event.status,
    privacyType: event.privacyType,
    websiteReleased: event.page?.isPublished ?? false,
  });
  if (!access.allowed) return null;

  const published = { visibility: ContentVisibility.PUBLISHED };
  const [sessions, speakers, form, confirmed, myRsvp] = await Promise.all([
    prisma.eventSession.findMany({
      where: { eventId: event.id, ...published },
      select: {
        id: true, title: true, startDateTime: true, endDateTime: true, sortOrder: true, delayMinutes: true, trackId: true,
        track: { select: { name: true, sortOrder: true } },
        speakers: {
          where: { speaker: { visibility: ContentVisibility.PUBLISHED } },
          orderBy: { sortOrder: "asc" },
          select: { speaker: { select: { name: true } } },
        },
      },
      orderBy: [{ startDateTime: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.eventSpeaker.findMany({
      where: { eventId: event.id, ...published },
      orderBy: { sortOrder: "asc" },
      select: { name: true, headline: true, photoUrl: true },
    }),
    prisma.eventRegistrationForm.findUnique({
      where: { eventId: event.id },
      select: { fields: { orderBy: { sortOrder: "asc" }, select: { id: true, key: true, label: true, type: true, required: true, options: true, helpText: true, placeholder: true, settings: true } } },
    }),
    // TEAM events count registration units (teams plus solo entrants) against capacity.
    countConfirmedForEvent(event.id, event.registrationMode),
    params.viewerUserId
      ? prisma.rSVP.findFirst({ where: { eventId: event.id, userId: params.viewerUserId }, select: { id: true, status: true, checkInToken: true } })
      : Promise.resolve(null),
  ]);

  const now = new Date();
  const reason = registrationClosedReason(event, now);
  const program = effectiveEventProgram(sessions);
  const tracks = new Map<string, { trackName: string | null; sortOrder: number; sessions: Array<{ id: string; title: string; startDateTime: string; endDateTime: string; delayMinutes: number; room: string | null; speakers: string[] }> }>();
  for (const session of program) {
    const key = session.trackId;
    const entry = tracks.get(key) ?? { trackName: session.track.name, sortOrder: session.track.sortOrder, sessions: [] };
    entry.sessions.push({
      id: session.id,
      title: session.title,
      startDateTime: session.effectiveStartDateTime.toISOString(),
      endDateTime: session.effectiveEndDateTime.toISOString(),
      delayMinutes: session.cumulativeDelayMinutes,
      room: null,
      speakers: session.speakers.map((link) => link.speaker.name),
    });
    tracks.set(key, entry);
  }

  return publicEventDtoSchema.parse({
    event: {
      ...toEventSummary(event, params.baseUrl),
      description: event.description,
      tags: event.tags,
      capacity: event.capacity,
      showRegistrationCount: event.showRegistrationCount,
      confirmedCount: event.showRegistrationCount ? confirmed : null,
      privacyType: event.privacyType,
      registrationOpen: reason === null,
      registrationFull: event.capacity != null && confirmed >= event.capacity,
      registrationClosedReason: reason,
      // Yuyu does not store a separate online-joining URL; reserved for future use.
      onlineUrl: null,
    },
    registration: {
      requiresApproval: event.privacyType === EventPrivacyType.APPROVAL_REQUIRED,
      fields: (form?.fields ?? []).map(toRegistrationField),
      myRsvp: myRsvp ? {
        rsvpId: myRsvp.id,
        status: myRsvp.status,
        ticketToken: myRsvp.status === RsvpStatus.CONFIRMED ? myRsvp.checkInToken : null,
      } : null,
    },
    schedule: [...tracks.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((track) => ({ trackName: track.trackName, sessions: track.sessions })),
    speakers: speakers.map((speaker) => ({
      name: speaker.name,
      title: speaker.headline.trim() || null,
      photoUrl: absoluteUrl(speaker.photoUrl, params.baseUrl),
    })),
    feedbackOpen: event.status === EventStatus.PUBLISHED && Boolean(event.feedbackForm?.isOpen),
  });
}

/** The public feedback form, exactly as /:orgSlug/:eventSlug/feedback decides it is open. */
export async function loadPublicFeedbackForm(orgSlug: string, eventSlug: string) {
  const event = await prisma.event.findFirst({
    where: { organisation: { slug: orgSlug }, slug: eventSlug, status: EventStatus.PUBLISHED },
    select: {
      feedbackForm: {
        select: {
          isOpen: true, title: true, thankYouMessage: true, certificateEnabled: true,
          fields: { orderBy: { sortOrder: "asc" }, select: { id: true, key: true, label: true, type: true, required: true, options: true } },
        },
      },
    },
  });
  const form = event?.feedbackForm;
  if (!form?.isOpen) return null;
  return feedbackFormDtoSchema.parse({
    title: form.title,
    intro: null,
    thankYouMessage: form.thankYouMessage,
    open: true,
    certificatesEnabled: form.certificateEnabled,
    fields: form.fields.map((field) => toRegistrationField(field)),
  });
}
