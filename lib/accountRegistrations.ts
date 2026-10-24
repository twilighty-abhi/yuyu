import "server-only";

import { EventPrivacyType, EventStatus, Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isEventPublished } from "@/lib/eventVisibility";
import { safeTimeZone } from "@/lib/timeZone";
import { formatDateBlock, formatDayShort, formatTimeRange } from "@/lib/format/datetime";
import type { ChipTone } from "@/components/ui/display";

/** Per-section cap. Upcoming and Past are each bounded; nothing here is unbounded. */
export const ACCOUNT_REGISTRATIONS_LIMIT = 50;
export const ACCOUNT_CERTIFICATES_LIMIT = 50;

/* ---------- Pure helpers (unit-tested) ---------- */

export type RegistrationStatusView = { label: string; tone: ChipTone };

/** The single attendee-facing status for one RSVP. A check-in outranks the RSVP status. */
export function registrationStatus(status: RsvpStatus, checkedInAt: Date | null): RegistrationStatusView {
  if (checkedInAt) return { label: "Checked in", tone: "success" };
  switch (status) {
    case RsvpStatus.CONFIRMED:
      return { label: "Confirmed", tone: "success" };
    case RsvpStatus.WAITLISTED:
      return { label: "Waitlisted", tone: "warning" };
    case RsvpStatus.PENDING_APPROVAL:
      return { label: "Waiting for approval", tone: "warning" };
    case RsvpStatus.REJECTED:
      return { label: "Declined", tone: "danger" };
    default:
      return { label: "Registered", tone: "neutral" };
  }
}

/** Upcoming until the occurrence has ended; ongoing events stay upcoming. */
export function isUpcoming(endDateTime: Date, now: Date): boolean {
  return endDateTime.getTime() >= now.getTime();
}

/**
 * Split occurrences into Upcoming (soonest first) and Past (most recent first),
 * each capped. Pure so the ordering rule is tested without a database.
 */
export function splitRegistrations<T extends { start: Date; end: Date }>(rows: readonly T[], now: Date, limit = ACCOUNT_REGISTRATIONS_LIMIT) {
  const upcoming = rows.filter((row) => isUpcoming(row.end, now)).sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = rows.filter((row) => !isUpcoming(row.end, now)).sort((a, b) => b.start.getTime() - a.start.getTime());
  return { upcoming: upcoming.slice(0, limit), past: past.slice(0, limit) };
}

/** Attendees may withdraw until check-in, while the occurrence has not ended and was not declined. */
export function canCancelRegistration(row: { status: RsvpStatus; checkedInAt: Date | null; end: Date }, now: Date): boolean {
  return !row.checkedInAt && row.status !== RsvpStatus.REJECTED && isUpcoming(row.end, now);
}

/**
 * Mirrors `resolvePublicEventAccess` for an ordinary attendee (no organiser
 * preview): published, website released, and for invite-only an invitation
 * matching the user's verified email.
 */
export function isEventPageReachable(input: {
  status: EventStatus;
  privacyType: EventPrivacyType;
  websiteReleased: boolean;
  invited: boolean;
}): boolean {
  if (!isEventPublished(input.status) || !input.websiteReleased) return false;
  return input.privacyType !== EventPrivacyType.INVITE_ONLY || input.invited;
}

/* ---------- Data loading ---------- */

const eventSelect = {
  id: true,
  title: true,
  slug: true,
  startDateTime: true,
  endDateTime: true,
  timezone: true,
  location: true,
  isOnline: true,
  status: true,
  privacyType: true,
  // Mobile registration cards (lib/mobile); never rendered by the web rows.
  coverImageUrl: true,
  mapLinkUrl: true,
  page: { select: { isPublished: true, accentColor: true } },
  organisation: { select: { name: true, slug: true, logoUrl: true } },
} satisfies Prisma.EventSelect;

const instanceSelect = {
  id: true,
  startDateTime: true,
  endDateTime: true,
  series: {
    select: {
      id: true,
      title: true,
      slug: true,
      timezone: true,
      status: true,
      privacyType: true,
      organisation: { select: { name: true, slug: true, logoUrl: true } },
    },
  },
} satisfies Prisma.EventInstanceSelect;

const rsvpSelect = {
  id: true,
  status: true,
  checkedInAt: true,
  checkInToken: true,
  createdAt: true,
  // Team events (docs/TEAMS.md): the name, and whether this registration leads it.
  team: { select: { id: true, name: true, leaderRsvpId: true } },
  event: { select: eventSelect },
  eventInstance: { select: instanceSelect },
} satisfies Prisma.RSVPSelect;

export type AccountRsvpRow = Prisma.RSVPGetPayload<{ select: typeof rsvpSelect }>;

/** Serializable, client-safe row. The ticket token travels only inside `ticketHref`/`cancelToken`, never as display text. */
export type AccountRegistrationRow = {
  id: string;
  title: string;
  organisationName: string;
  dateBlock: { month: string; day: string };
  dateLabel: string;
  timeLabel: string;
  location: string | null;
  isOnline: boolean;
  isSeries: boolean;
  eventCancelled: boolean;
  status: RegistrationStatusView;
  ticketHref: string | null;
  eventHref: string | null;
  /** Present only when the existing cancel action may be offered. */
  cancelToken: string | null;
  /** Team registrations: the team name, and for its leader the signed-in team page. */
  team: { name: string; isLeader: boolean; manageHref: string | null } | null;
};

export type AccountCertificateRow = {
  id: string;
  title: string;
  organisationName: string;
  issuedLabel: string;
  certificateHref: string;
};

export type NormalisedAccountRegistration = {
  rsvp: AccountRsvpRow;
  title: string;
  organisationName: string;
  start: Date;
  end: Date;
  timeZone: string;
  location: string | null;
  isOnline: boolean;
  isSeries: boolean;
  eventStatus: EventStatus;
  eventHref: string | null;
};

function normalise(rsvp: AccountRsvpRow, invitedEventIds: Set<string>, invitedSeriesIds: Set<string>): NormalisedAccountRegistration | null {
  if (rsvp.event) {
    const event = rsvp.event;
    const reachable = isEventPageReachable({
      status: event.status,
      privacyType: event.privacyType,
      websiteReleased: event.page?.isPublished ?? false,
      invited: invitedEventIds.has(event.id),
    });
    return {
      rsvp,
      title: event.title,
      organisationName: event.organisation.name,
      start: event.startDateTime,
      end: event.endDateTime,
      timeZone: safeTimeZone(event.timezone),
      location: event.location.trim() || null,
      isOnline: event.isOnline,
      isSeries: false,
      eventStatus: event.status,
      eventHref: reachable ? `/${event.organisation.slug}/${event.slug}` : null,
    };
  }
  if (rsvp.eventInstance) {
    const instance = rsvp.eventInstance;
    const series = instance.series;
    const reachable = isEventPageReachable({
      status: series.status,
      privacyType: series.privacyType,
      websiteReleased: true,
      invited: invitedSeriesIds.has(series.id),
    });
    return {
      rsvp,
      title: series.title,
      organisationName: series.organisation.name,
      start: instance.startDateTime,
      end: instance.endDateTime,
      timeZone: safeTimeZone(series.timezone),
      location: null,
      isOnline: false,
      isSeries: true,
      eventStatus: series.status,
      eventHref: reachable ? `/${series.organisation.slug}/i/${instance.id}` : null,
    };
  }
  return null;
}

function toRow(item: NormalisedAccountRegistration, now: Date): AccountRegistrationRow {
  const { rsvp } = item;
  const cancellable = canCancelRegistration({ status: rsvp.status, checkedInAt: rsvp.checkedInAt, end: item.end }, now);
  const showTicket = rsvp.status !== RsvpStatus.REJECTED;
  return {
    id: rsvp.id,
    title: item.title,
    organisationName: item.organisationName,
    dateBlock: formatDateBlock(item.start, item.timeZone),
    dateLabel: formatDayShort(item.start, item.timeZone, now),
    timeLabel: formatTimeRange(item.start, item.end, item.timeZone),
    location: item.location,
    isOnline: item.isOnline,
    isSeries: item.isSeries,
    eventCancelled: item.eventStatus === EventStatus.CANCELLED,
    status: registrationStatus(rsvp.status, rsvp.checkedInAt),
    ticketHref: showTicket ? `/ticket/${rsvp.checkInToken}` : null,
    eventHref: item.eventHref,
    cancelToken: cancellable ? rsvp.checkInToken : null,
    team: teamView(rsvp),
  };
}

/** The leader link resolves only for the signed-in leader (`resolveLeaderForUser`); the id alone grants nothing. */
function teamView(rsvp: AccountRsvpRow): AccountRegistrationRow["team"] {
  const team = rsvp.team;
  if (!team) return null;
  const isLeader = team.leaderRsvpId === rsvp.id;
  return { name: team.name, isLeader, manageHref: isLeader ? `/account/teams/${encodeURIComponent(team.id)}` : null };
}

/**
 * The signed-in user's own registrations. Every query is keyed on
 * `RSVP.userId` (never an email match) and bounded with `take`.
 */
export async function loadAccountRegistrations(userId: string, now: Date = new Date()) {
  const { upcoming, past, certificates } = await loadAccountRegistrationRecords(userId, now);
  return {
    upcoming: upcoming.map((item) => toRow(item, now)),
    past: past.map((item) => toRow(item, now)),
    certificates: certificates.map((certificate): AccountCertificateRow => ({
      id: certificate.id,
      title: certificate.title,
      organisationName: certificate.organisationName,
      issuedLabel: formatDayShort(certificate.issuedAt, certificate.timeZone, now),
      certificateHref: certificate.certificateHref,
    })),
  };
}

export type AccountCertificateRecord = {
  id: string;
  title: string;
  organisationName: string;
  issuedAt: Date;
  timeZone: string;
  certificateHref: string;
};

/**
 * The records behind `loadAccountRegistrations`, shared with the mobile API so
 * both apply the same ownership, ordering, caps and page-reachability rules.
 */
export async function loadAccountRegistrationRecords(userId: string, now: Date = new Date()) {
  const take = ACCOUNT_REGISTRATIONS_LIMIT;
  const [upcomingEvents, upcomingInstances, pastEvents, pastInstances, certificates, user] = await Promise.all([
    prisma.rSVP.findMany({
      where: { userId, event: { is: { endDateTime: { gte: now } } } },
      orderBy: { event: { startDateTime: "asc" } },
      take,
      select: rsvpSelect,
    }),
    prisma.rSVP.findMany({
      where: { userId, eventInstance: { is: { endDateTime: { gte: now } } } },
      orderBy: { eventInstance: { startDateTime: "asc" } },
      take,
      select: rsvpSelect,
    }),
    prisma.rSVP.findMany({
      where: { userId, event: { is: { endDateTime: { lt: now } } } },
      orderBy: { event: { startDateTime: "desc" } },
      take,
      select: rsvpSelect,
    }),
    prisma.rSVP.findMany({
      where: { userId, eventInstance: { is: { endDateTime: { lt: now } } } },
      orderBy: { eventInstance: { startDateTime: "desc" } },
      take,
      select: rsvpSelect,
    }),
    // Mirrors the certificate route: issued token on the user's own confirmed RSVP.
    prisma.eventFeedbackResponse.findMany({
      where: { certificateToken: { not: null }, rsvp: { is: { userId, status: RsvpStatus.CONFIRMED } } },
      orderBy: { submittedAt: "desc" },
      take: ACCOUNT_CERTIFICATES_LIMIT,
      select: {
        id: true,
        certificateToken: true,
        submittedAt: true,
        form: { select: { event: { select: { title: true, timezone: true, organisation: { select: { name: true } } } } } },
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } }),
  ]);

  const rsvps = [...upcomingEvents, ...upcomingInstances, ...pastEvents, ...pastInstances];

  // Invite-only pages require an invitation for the user's verified email,
  // exactly as `resolvePublicEventAccess` does. Batched, bounded by the RSVP ids above.
  const email = user?.emailVerified ? user.email?.trim().toLowerCase() : null;
  const inviteOnlyEventIds = [...new Set(rsvps.flatMap((r) => (r.event?.privacyType === EventPrivacyType.INVITE_ONLY ? [r.event.id] : [])))];
  const inviteOnlySeriesIds = [...new Set(rsvps.flatMap((r) => (r.eventInstance?.series.privacyType === EventPrivacyType.INVITE_ONLY ? [r.eventInstance.series.id] : [])))];
  const [eventInvites, seriesInvites] = email
    ? await Promise.all([
        inviteOnlyEventIds.length
          ? prisma.eventInvite.findMany({ where: { email, eventId: { in: inviteOnlyEventIds } }, select: { eventId: true } })
          : Promise.resolve([]),
        inviteOnlySeriesIds.length
          ? prisma.seriesInvite.findMany({ where: { email, eventSeriesId: { in: inviteOnlySeriesIds } }, select: { eventSeriesId: true } })
          : Promise.resolve([]),
      ])
    : [[], []];
  const invitedEventIds = new Set(eventInvites.map((invite) => invite.eventId));
  const invitedSeriesIds = new Set(seriesInvites.map((invite) => invite.eventSeriesId));

  const normalised = rsvps.flatMap((rsvp) => {
    const item = normalise(rsvp, invitedEventIds, invitedSeriesIds);
    return item ? [item] : [];
  });
  const { upcoming, past } = splitRegistrations(normalised, now);

  return {
    upcoming,
    past,
    certificates: certificates.flatMap((response): AccountCertificateRecord[] =>
      response.certificateToken
        ? [{
            id: response.id,
            title: response.form.event.title,
            organisationName: response.form.event.organisation.name,
            issuedAt: response.submittedAt,
            timeZone: safeTimeZone(response.form.event.timezone),
            certificateHref: `/api/feedback/certificate/${response.certificateToken}`,
          }]
        : [],
    ),
  };
}
