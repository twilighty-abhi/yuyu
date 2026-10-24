import "server-only";

import { RsvpStatus, type Membership, type Prisma } from "@prisma/client";
import { decodeCursor, encodeCursor } from "@/lib/api/v1/pagination";
import { BROADCAST_PLACEHOLDERS, BROADCAST_STARTER_TEMPLATES } from "@/lib/broadcastTemplate";
import { getRegistrationDetails } from "@/lib/checkInDetails";
import { registrationWindowState } from "@/lib/core/registrationWindow";
import { prisma } from "@/lib/db";
import { BROADCAST_DESIGNS, DEFAULT_BROADCAST_DESIGN, isBroadcastDesign } from "@/lib/email/broadcastDesigns";
import { getMembership, isOrgAdmin } from "@/lib/permissions";
import { attendeeDisplayName, eventSummarySelect, guestRsvpSelect, toEventSummary, toGuest } from "@/lib/mobile/dto";
import type { EventCountsDto, EventPermissionsDto } from "@/lib/mobile/schemas";
import { canSeeGuests, eventPermissionsFor } from "@/lib/mobile/permissions";

export { canSeeGuests, eventPermissionsFor };
import {
  broadcastsMetaDtoSchema,
  checkInStatsDtoSchema,
  guestDetailDtoSchema,
  guestListDtoSchema,
  orgEventDetailDtoSchema,
  orgEventsDtoSchema,
  scheduleDtoSchema,
} from "@/lib/mobile/schemas";

/*
 * Organiser reads for the mobile apps. Access mirrors the event dashboard
 * (lib/eventDashboard/context.ts): organisation members see the
 * organisation's events, collaborators only their granted events, and an
 * event outside that set (including another organisation's) is NOT_FOUND.
 * Mutations never rely on these flags; the shared core functions re-check.
 */

export type MobileEventContext = {
  organisation: { id: string; slug: string; name: string };
  membership: Membership | null;
  event: { id: string; slug: string };
  permissions: EventPermissionsDto;
};

export async function resolveOrgAccess(userId: string, orgSlug: string) {
  const organisation = await prisma.organisation.findUnique({ where: { slug: orgSlug }, select: { id: true, slug: true, name: true } });
  if (!organisation) return null;
  const membership = await getMembership(userId, organisation.id);
  return { organisation, membership };
}

/** Event in this organisation that the caller may see on the dashboard, or null (NOT_FOUND). */
export async function resolveEventContext(userId: string, orgSlug: string, eventId: string): Promise<MobileEventContext | null> {
  if (!eventId || eventId.length > 128) return null;
  const access = await resolveOrgAccess(userId, orgSlug);
  if (!access) return null;
  const event = await prisma.event.findFirst({ where: { id: eventId, organisationId: access.organisation.id }, select: { id: true, slug: true } });
  if (!event) return null;
  const isAdmin = Boolean(access.membership && isOrgAdmin(access.membership.role));
  const grant = isAdmin
    ? null
    : await prisma.eventCollaborator.findFirst({ where: { eventId: event.id, userId }, select: { permissions: true } });
  if (!access.membership && !grant) return null;
  return {
    organisation: access.organisation,
    membership: access.membership,
    event,
    permissions: eventPermissionsFor(isAdmin, grant?.permissions ?? []),
  };
}

async function loadCounts(eventIds: string[]): Promise<Map<string, Omit<EventCountsDto, "capacity">>> {
  const result = new Map<string, Omit<EventCountsDto, "capacity">>();
  if (eventIds.length === 0) return result;
  const [byStatus, checkedIn, teamed, teams] = await Promise.all([
    prisma.rSVP.groupBy({ by: ["eventId", "status"], where: { eventId: { in: eventIds } }, _count: { _all: true } }),
    prisma.rSVP.groupBy({ by: ["eventId"], where: { eventId: { in: eventIds }, checkedInAt: { not: null } }, _count: { _all: true } }),
    // TEAM events fill capacity in units: confirmed people outside teams plus confirmed teams.
    prisma.rSVP.groupBy({ by: ["eventId"], where: { eventId: { in: eventIds }, status: RsvpStatus.CONFIRMED, teamId: { not: null } }, _count: { _all: true } }),
    prisma.team.groupBy({ by: ["eventId"], where: { eventId: { in: eventIds }, status: RsvpStatus.CONFIRMED }, _count: { _all: true } }),
  ]);
  for (const id of eventIds) result.set(id, { confirmed: 0, waitlisted: 0, pending: 0, checkedIn: 0, capacityUsed: 0 });
  for (const row of byStatus) {
    const entry = row.eventId ? result.get(row.eventId) : undefined;
    if (!entry) continue;
    if (row.status === RsvpStatus.CONFIRMED) entry.confirmed = row._count._all;
    if (row.status === RsvpStatus.WAITLISTED) entry.waitlisted = row._count._all;
    if (row.status === RsvpStatus.PENDING_APPROVAL) entry.pending = row._count._all;
  }
  for (const row of checkedIn) {
    const entry = row.eventId ? result.get(row.eventId) : undefined;
    if (entry) entry.checkedIn = row._count._all;
  }
  const teamedBy = new Map(teamed.map((row) => [row.eventId, row._count._all]));
  const teamsBy = new Map(teams.map((row) => [row.eventId, row._count._all]));
  for (const [id, entry] of result) entry.capacityUsed = entry.confirmed - (teamedBy.get(id) ?? 0) + (teamsBy.get(id) ?? 0);
  return result;
}

const ORG_EVENTS_LIMIT = 200;

export async function listOrgEvents(userId: string, orgSlug: string, filter: "upcoming" | "past" | "all", baseUrl: string, now = new Date()) {
  const access = await resolveOrgAccess(userId, orgSlug);
  if (!access) return null;
  const isAdmin = Boolean(access.membership && isOrgAdmin(access.membership.role));
  const grants = isAdmin
    ? []
    : await prisma.eventCollaborator.findMany({
        where: { userId, eventId: { not: null }, event: { organisationId: access.organisation.id } },
        select: { eventId: true, permissions: true },
      });
  if (!access.membership && grants.length === 0) return null;
  const grantByEvent = new Map(grants.map((grant) => [grant.eventId!, grant.permissions]));

  const timeWhere: Prisma.EventWhereInput = filter === "upcoming" ? { endDateTime: { gte: now } } : filter === "past" ? { endDateTime: { lt: now } } : {};
  const events = await prisma.event.findMany({
    where: {
      organisationId: access.organisation.id,
      ...timeWhere,
      // Members see every organisation event, collaborators only their own.
      ...(access.membership ? {} : { id: { in: [...grantByEvent.keys()] } }),
    },
    select: { ...eventSummarySelect, capacity: true },
    orderBy: filter === "upcoming" ? [{ startDateTime: "asc" }, { id: "asc" }] : [{ startDateTime: "desc" }, { id: "desc" }],
    take: ORG_EVENTS_LIMIT,
  });
  const permissionsByEvent = new Map(events.map((event) => [event.id, eventPermissionsFor(isAdmin, grantByEvent.get(event.id) ?? [])]));
  const counts = await loadCounts(events.filter((event) => canSeeGuests(permissionsByEvent.get(event.id)!)).map((event) => event.id));
  return orgEventsDtoSchema.parse({
    events: events.map((event) => {
      const eventCounts = counts.get(event.id);
      return {
        ...toEventSummary(event, baseUrl),
        counts: eventCounts ? { ...eventCounts, capacity: event.capacity } : null,
        myPermissions: permissionsByEvent.get(event.id)!,
      };
    }),
  });
}

export async function loadOrgEventDetail(ctx: MobileEventContext, baseUrl: string) {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id: ctx.event.id },
    select: {
      ...eventSummarySelect,
      capacity: true,
      privacyType: true,
      shortCode: true,
      registrationClosesAt: true,
      registrationLeadMinutes: true,
      registrationManuallyClosedAt: true,
      feedbackForm: { select: { isOpen: true } },
    },
  });
  const counts = canSeeGuests(ctx.permissions) ? (await loadCounts([event.id])).get(event.id) : undefined;
  const window = registrationWindowState(event);
  return orgEventDetailDtoSchema.parse({
    event: {
      ...toEventSummary(event, baseUrl),
      privacyType: event.privacyType,
      registrationOpen: window.registrationOpen,
      registrationClosesAt: window.registrationClosesAt,
      registrationClosedReason: window.registrationClosedReason,
      registrationManuallyClosed: window.registrationManuallyClosed,
      feedbackOpen: Boolean(event.feedbackForm?.isOpen),
      eventUrl: `${baseUrl}/${event.organisation.slug}/${event.slug}`,
      shortUrl: event.shortCode ? `${baseUrl}/${event.shortCode}` : null,
    },
    counts: counts ? { ...counts, capacity: event.capacity } : null,
    myPermissions: ctx.permissions,
  });
}

export type GuestQuery = {
  status: "ALL" | RsvpStatus;
  checkedIn: "any" | "yes" | "no";
  q?: string;
  cursor?: string;
  limit: number;
};

export async function listGuests(ctx: MobileEventContext, query: GuestQuery) {
  const cursor = decodeCursor(query.cursor);
  if (query.cursor && !cursor) return null;
  const q = query.q?.trim();
  const and: Prisma.RSVPWhereInput[] = [];
  if (q) {
    and.push({ OR: [
      { guestEmail: { contains: q, mode: "insensitive" } },
      { guestName: { contains: q, mode: "insensitive" } },
      { user: { email: { contains: q, mode: "insensitive" } } },
      { user: { name: { contains: q, mode: "insensitive" } } },
    ] });
  }
  if (cursor) {
    and.push({ OR: [
      { createdAt: { lt: new Date(cursor.timestamp) } },
      { createdAt: new Date(cursor.timestamp), id: { lt: cursor.id } },
    ] });
  }
  const rows = await prisma.rSVP.findMany({
    where: {
      eventId: ctx.event.id,
      ...(query.status === "ALL" ? {} : { status: query.status }),
      ...(query.checkedIn === "yes" ? { checkedInAt: { not: null } } : query.checkedIn === "no" ? { checkedInAt: null } : {}),
      ...(and.length ? { AND: and } : {}),
    },
    select: guestRsvpSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return guestListDtoSchema.parse({
    guests: page.map(toGuest),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
  });
}

export async function loadGuestDetail(ctx: MobileEventContext, rsvpId: string) {
  const rsvp = await prisma.rSVP.findFirst({
    where: { id: rsvpId, eventId: ctx.event.id },
    select: { ...guestRsvpSelect, answers: { select: { valueText: true, valueBool: true, valueNumber: true, valueDate: true, field: { select: { key: true, label: true } } } } },
  });
  if (!rsvp) return null;
  return guestDetailDtoSchema.parse({
    ...toGuest(rsvp),
    answers: getRegistrationDetails(rsvp.answers).map(({ label, value }) => ({ label, value })),
  });
}

export async function loadGuest(ctx: MobileEventContext, rsvpId: string) {
  const rsvp = await prisma.rSVP.findFirst({ where: { id: rsvpId, eventId: ctx.event.id }, select: guestRsvpSelect });
  return rsvp ? toGuest(rsvp) : null;
}

export async function loadCheckInStats(ctx: MobileEventContext) {
  const [confirmed, checkedIn, recent] = await Promise.all([
    prisma.rSVP.count({ where: { eventId: ctx.event.id, status: RsvpStatus.CONFIRMED } }),
    prisma.rSVP.count({ where: { eventId: ctx.event.id, checkedInAt: { not: null } } }),
    prisma.rSVP.findMany({
      where: { eventId: ctx.event.id, checkedInAt: { not: null } },
      orderBy: [{ checkedInAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { id: true, checkedInAt: true, guestName: true, guestEmail: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  return checkInStatsDtoSchema.parse({
    confirmed,
    checkedIn,
    recent: recent.map((row) => ({ rsvpId: row.id, displayName: attendeeDisplayName(row), checkedInAt: row.checkedInAt!.toISOString() })),
  });
}

export async function loadBroadcastsMeta(ctx: MobileEventContext) {
  const history = await prisma.eventBroadcast.findMany({
    where: { eventId: ctx.event.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, subject: true, body: true, design: true, statuses: true, attendance: true, recipientCount: true, createdAt: true },
  });
  return broadcastsMetaDtoSchema.parse({
    templates: BROADCAST_STARTER_TEMPLATES.map((template) => ({
      id: template.id,
      group: template.group,
      name: template.name,
      description: template.description,
      subject: template.subject,
      bodyHtml: template.bodyHtml,
      audience: { statuses: [...template.audience.statuses], attendance: template.audience.attendance },
    })),
    designs: BROADCAST_DESIGNS.map((design) => ({ id: design.id, label: design.name, description: design.description })),
    placeholders: BROADCAST_PLACEHOLDERS.map((placeholder) => placeholder.token),
    history: history.map((row) => ({
      id: row.id,
      subject: row.subject,
      design: isBroadcastDesign(row.design) ? row.design : DEFAULT_BROADCAST_DESIGN,
      audience: { statuses: row.statuses, attendance: row.attendance },
      recipientCount: row.recipientCount,
      sentAt: row.createdAt.toISOString(),
      bodyHtml: row.body,
    })),
  });
}

/** The organiser programme: every session (any visibility) with its stored live delay, grouped by track. */
export async function loadOrganiserSchedule(ctx: MobileEventContext) {
  const [tracks, sessions] = await Promise.all([
    prisma.eventScheduleTrack.findMany({ where: { eventId: ctx.event.id }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.eventSession.findMany({
      where: { eventId: ctx.event.id },
      orderBy: [{ startDateTime: "asc" }, { sortOrder: "asc" }],
      select: { id: true, title: true, startDateTime: true, endDateTime: true, delayMinutes: true, trackId: true },
    }),
  ]);
  return scheduleDtoSchema.parse({
    tracks: tracks.map((track) => ({
      id: track.id,
      name: track.name,
      sessions: sessions.filter((session) => session.trackId === track.id).map((session) => ({
        id: session.id,
        title: session.title,
        startDateTime: session.startDateTime.toISOString(),
        endDateTime: session.endDateTime.toISOString(),
        delayMinutes: session.delayMinutes,
      })),
    })),
  });
}
