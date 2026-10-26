import "server-only";

import { EventPrivacyType, EventStatus, Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isEventPublished } from "@/lib/eventVisibility";
import { safeTimeZone } from "@/lib/timeZone";
import { formatDateBlock, formatDayShort, formatTimeRange } from "@/lib/format/datetime";
import type { ChipTone } from "@/components/ui/display";

/** Rows per page in each section (Upcoming, Past, Certificates); nothing here is unbounded. */
export const ACCOUNT_REGISTRATIONS_LIMIT = 50;
export const ACCOUNT_CERTIFICATES_LIMIT = 50;
/** Highest page number accepted from the URL (`?past=3`). */
export const MAX_ACCOUNT_PAGE = 1000;

export const ACCOUNT_SECTIONS = ["upcoming", "past", "certificates"] as const;
export type AccountSectionKey = (typeof ACCOUNT_SECTIONS)[number];
export type AccountPages = Record<AccountSectionKey, number>;
export type AccountSectionPagination = { page: number; totalPages: number; total: number; pageSize: number };

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

/** A section's page number from the URL; anything malformed is page 1. */
export function accountPageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,4}$/.test(raw)) return 1;
  return Math.min(MAX_ACCOUNT_PAGE, Math.max(1, Number(raw)));
}

/** Clamp a requested page to the pages that exist (an empty section still has page 1). */
export function accountSectionPagination(requested: number, total: number, pageSize: number): AccountSectionPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Math.max(1, requested), totalPages), totalPages, total, pageSize };
}

/** Section page links that keep the other sections' pages (page 1 is left out of the URL). */
export function accountSectionHref(pages: AccountPages, section: AccountSectionKey, page: number): string {
  const params = new URLSearchParams();
  for (const key of ACCOUNT_SECTIONS) {
    const value = key === section ? page : pages[key];
    if (value > 1) params.set(key, String(value));
  }
  const query = params.toString();
  return `/account/registrations${query ? `?${query}` : ""}#${section}`;
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
  // Hackathon events (docs/HACKATHON.md): whether to link the entrant's project page.
  submissionsEnabled: true,
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
  /** Events taking hackathon submissions: the signed-in project page (team or solo). */
  submissionHref: string | null;
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
    submissionHref: submissionHref(rsvp),
  };
}

/**
 * The project page resolves only for this signed-in account's own
 * registration (`resolveEntrantForUser`); the event id alone grants nothing.
 * Like the page itself, it is offered only while the event is published and
 * its website released.
 */
export function submissionHref(rsvp: {
  status: RsvpStatus;
  event: { id: string; submissionsEnabled: boolean; status: EventStatus; page: { isPublished: boolean } | null } | null;
}): string | null {
  const event = rsvp.event;
  if (!event?.submissionsEnabled || rsvp.status === RsvpStatus.REJECTED) return null;
  if (event.status !== EventStatus.PUBLISHED || event.page?.isPublished !== true) return null;
  return `/account/submissions/${encodeURIComponent(event.id)}`;
}

/** The leader link resolves only for the signed-in leader (`resolveLeaderForUser`); the id alone grants nothing. */
function teamView(rsvp: AccountRsvpRow): AccountRegistrationRow["team"] {
  const team = rsvp.team;
  if (!team) return null;
  const isLeader = team.leaderRsvpId === rsvp.id;
  return { name: team.name, isLeader, manageHref: isLeader ? `/account/teams/${encodeURIComponent(team.id)}` : null };
}

/**
 * The signed-in user's own registrations, one page per section. Every query
 * is keyed on `RSVP.userId` (never an email match) and bounded by the page size.
 */
export async function loadAccountRegistrations(userId: string, now: Date = new Date(), pages: Partial<AccountPages> = {}) {
  const { upcoming, past, certificates, pagination } = await loadAccountRegistrationRecords(userId, now, pages);
  return {
    pagination,
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

const REGISTRATION_FROM = Prisma.sql`"RSVP" r
  LEFT JOIN "Event" e ON e."id" = r."eventId"
  LEFT JOIN "EventInstance" i ON i."id" = r."eventInstanceId"`;

/**
 * One page of the user's registrations in a section, ordered across one-off
 * events and series occurrences together (the event's dates win, as in
 * `normalise`): Upcoming soonest first, Past most recent first, then by id.
 * Keyed on `RSVP.userId` only, with a separate count for the page numbers.
 */
async function registrationSectionPage(userId: string, now: Date, section: "upcoming" | "past", requestedPage: number) {
  const at = now.toISOString().replace("Z", "");
  const where =
    section === "upcoming"
      ? Prisma.sql`r."userId" = ${userId} AND COALESCE(e."endDateTime", i."endDateTime") >= ${at}::timestamp(3)`
      : Prisma.sql`r."userId" = ${userId} AND COALESCE(e."endDateTime", i."endDateTime") < ${at}::timestamp(3)`;
  const order =
    section === "upcoming"
      ? Prisma.sql`COALESCE(e."startDateTime", i."startDateTime") ASC, r."id" ASC`
      : Prisma.sql`COALESCE(e."startDateTime", i."startDateTime") DESC, r."id" ASC`;
  const counted = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS "count" FROM ${REGISTRATION_FROM} WHERE ${where}`;
  const pagination = accountSectionPagination(requestedPage, Number(counted[0]?.count ?? 0), ACCOUNT_REGISTRATIONS_LIMIT);
  if (pagination.total === 0) return { rows: [] as AccountRsvpRow[], pagination };
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT r."id" FROM ${REGISTRATION_FROM}
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ${ACCOUNT_REGISTRATIONS_LIMIT} OFFSET ${(pagination.page - 1) * ACCOUNT_REGISTRATIONS_LIMIT}`;
  const found = ids.length
    ? await prisma.rSVP.findMany({ where: { id: { in: ids.map((row) => row.id) }, userId }, select: rsvpSelect })
    : [];
  const byId = new Map(found.map((rsvp) => [rsvp.id, rsvp]));
  return { rows: ids.flatMap((row) => byId.get(row.id) ?? []), pagination };
}

/** One page of the user's certificates, newest first (issued token on their own confirmed RSVP, as the certificate route checks). */
async function certificatePage(userId: string, requestedPage: number) {
  const where = { certificateToken: { not: null }, rsvp: { is: { userId, status: RsvpStatus.CONFIRMED } } } satisfies Prisma.EventFeedbackResponseWhereInput;
  const total = await prisma.eventFeedbackResponse.count({ where });
  const pagination = accountSectionPagination(requestedPage, total, ACCOUNT_CERTIFICATES_LIMIT);
  const rows = total
    ? await prisma.eventFeedbackResponse.findMany({
        where,
        orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
        skip: (pagination.page - 1) * ACCOUNT_CERTIFICATES_LIMIT,
        take: ACCOUNT_CERTIFICATES_LIMIT,
        select: {
          id: true,
          certificateToken: true,
          submittedAt: true,
          form: { select: { event: { select: { title: true, timezone: true, organisation: { select: { name: true } } } } } },
        },
      })
    : [];
  return { rows, pagination };
}

/**
 * The records behind `loadAccountRegistrations`, shared with the mobile API so
 * both apply the same ownership, ordering, page size and page-reachability
 * rules. Each section is paged on its own (`pages`, default page 1); the
 * mobile API reads the first page of each.
 */
export async function loadAccountRegistrationRecords(userId: string, now: Date = new Date(), pages: Partial<AccountPages> = {}) {
  const [upcomingPage, pastPage, certificatesPage, user] = await Promise.all([
    registrationSectionPage(userId, now, "upcoming", pages.upcoming ?? 1),
    registrationSectionPage(userId, now, "past", pages.past ?? 1),
    certificatePage(userId, pages.certificates ?? 1),
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } }),
  ]);
  const certificates = certificatesPage.rows;

  const rsvps = [...upcomingPage.rows, ...pastPage.rows];

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

  const normaliseAll = (rows: AccountRsvpRow[]) =>
    rows.flatMap((rsvp) => {
      const item = normalise(rsvp, invitedEventIds, invitedSeriesIds);
      return item ? [item] : [];
    });

  return {
    upcoming: normaliseAll(upcomingPage.rows),
    past: normaliseAll(pastPage.rows),
    pagination: { upcoming: upcomingPage.pagination, past: pastPage.pagination, certificates: certificatesPage.pagination },
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
