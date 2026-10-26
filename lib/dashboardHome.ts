import "server-only";

import type { EventStatus, Prisma, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isOrgAdmin } from "@/lib/permissions";
import { getAccentTokens } from "@/lib/theme/accent";
import { teamUnitNoun, teamUnitShortNoun } from "@/lib/teamCapacityDisplay";
import { dailyCounts, eventFillStatus, forwardDailyCounts, homeSummary, intervalCounts, nowAndNext, toDotLevels, weekOverWeek, type FillStatus } from "@/lib/dashboardHomeMetrics";

/*
 * Data for the dashboard home. Everything is scoped to organisations the
 * person belongs to (any role), the same scope the page always had; things
 * that ask for action (approvals, drafts, check-in) only come from
 * organisations they manage (OWNER/ADMIN). Guest emails are never returned.
 */

const DAY_MS = 86_400_000;
const LIVE_LEAD_MS = 2 * 60 * 60_000; // event-day mode starts two hours before doors
const ARRIVAL_BUCKET_MS = 15 * 60_000;
const ARRIVAL_BUCKETS = 8;
const LIST_LIMIT = 6;
const SAMPLE_LIMIT = 5000; // cap on timestamps pulled for the weekly dot charts

const LISTED: EventStatus[] = ["PUBLISHED", "HIDDEN"];

export type HomeEventRow = {
  key: string;
  /** Management link; null when the person cannot manage this organisation's events. */
  href: string | null;
  title: string;
  organisationName: string;
  dateBlock: { start: Date; timezone: string };
  meta: string;
  accent: string;
  isSeries: boolean;
  isDraft: boolean;
  status: FillStatus;
  fill: { filled: number; total: number } | null;
};

export type HomeActivity = {
  key: string;
  kind: "registered" | "waitlisted" | "pending" | "checkedIn" | "feedback";
  who: string;
  eventTitle: string;
  at: Date;
  timezone: string;
};

export type HomeStat = { label: string; value: number | string; hint: string; levels: number[]; tone: "ink" | "marigold" | "success" | "amber" };

export type HomeOrganisation = { id: string; slug: string; name: string; logoUrl: string | null; role: string; upcoming: number; members: number };

export type HomeLiveEvent = {
  id: string;
  title: string;
  /** Management link; null for members who cannot manage events. */
  href: string | null;
  checkInHref: string | null;
  scheduleHref: string | null;
  timezone: string;
  location: string;
  startDateTime: Date;
  endDateTime: Date;
  started: boolean;
  confirmed: number;
  checkedIn: number;
  arrivals: { label: Date; count: number }[];
  door: { key: string; who: string; at: Date }[];
  onStage: { now: { title: string; start: Date; end: Date } | null; next: { title: string; start: Date } | null };
};

export type DashboardHome = {
  summary: string;
  mood: "happy" | "cheering" | "sleepy";
  organisations: HomeOrganisation[];
  adminOrganisations: { slug: string; name: string }[];
  needsYou: { pendingApprovals: number; approvalsHref: string | null; drafts: number; draftHref: string | null } | null;
  next: (HomeEventRow & { location: string; startDateTime: Date; timezone: string; confirmed: number; capacity: number | null; capacityUnits: { used: number; noun: string } | null; signupsLastDay: number; checkInHref: string | null; recentNames: string[]; publicPath: string | null }) | null;
  stats: HomeStat[];
  upcoming: HomeEventRow[];
  drafts: HomeEventRow[];
  past: HomeEventRow[];
  counts: { upcoming: number; drafts: number };
  activity: HomeActivity[];
  live: HomeLiveEvent | null;
  setup: { hasOrganisation: boolean; hasLogo: boolean; hasEvent: boolean; hasPublished: boolean; firstAdminSlug: string | null } | null;
};

function displayName(rsvp: { guestName: string | null; user: { name: string | null } | null }) {
  return rsvp.user?.name?.trim() || rsvp.guestName?.trim() || "A guest";
}

function firstName(name: string) {
  return name === "A guest" ? name : name.split(/\s+/)[0];
}

function accentOf(value: string | null | undefined) {
  return getAccentTokens(value, "light")["--yy-accent"];
}

type CountKey = { eventId?: string | null; eventInstanceId?: string | null; status: RsvpStatus; _count: { _all: number } };

function tally(groups: CountKey[], key: "eventId" | "eventInstanceId") {
  const map = new Map<string, { confirmed: number; waitlisted: number; pending: number }>();
  for (const group of groups) {
    const id = group[key];
    if (!id) continue;
    const entry = map.get(id) ?? { confirmed: 0, waitlisted: 0, pending: 0 };
    if (group.status === "CONFIRMED") entry.confirmed += group._count._all;
    if (group.status === "WAITLISTED") entry.waitlisted += group._count._all;
    if (group.status === "PENDING_APPROVAL") entry.pending += group._count._all;
    map.set(id, entry);
  }
  return map;
}

export const eventSelect = {
  id: true,
  organisationId: true,
  title: true,
  slug: true,
  startDateTime: true,
  endDateTime: true,
  timezone: true,
  location: true,
  isOnline: true,
  capacity: true,
  registrationMode: true,
  soloPolicy: true,
  status: true,
  organisation: { select: { slug: true, name: true } },
  page: { select: { accentColor: true } },
} satisfies Prisma.EventSelect;

export type EventForRow = Prisma.EventGetPayload<{ select: typeof eventSelect }>;

export type RsvpCounts = { event: Map<string, CountTriple>; instance: Map<string, CountTriple>; units: Map<string, number> };
type CountTriple = { confirmed: number; waitlisted: number; pending: number };
const EMPTY_COUNTS: CountTriple = { confirmed: 0, waitlisted: 0, pending: 0 };

/**
 * Confirmed / waitlisted / pending counts for the listed events and series
 * dates, plus the places used against capacity per event: confirmed people
 * minus crew (docs/CREW.md) and those in teams, plus confirmed teams
 * (docs/TEAMS.md).
 */
export async function loadRsvpCounts(eventIds: string[], instanceIds: string[]): Promise<RsvpCounts> {
  const uniqueEvents = [...new Set(eventIds)];
  const [eventGroups, instanceGroups, teamedGroups, teamGroups, crewGroups] = await Promise.all([
    uniqueEvents.length ? prisma.rSVP.groupBy({ by: ["eventId", "status"], where: { eventId: { in: uniqueEvents } }, _count: { _all: true } }) : Promise.resolve([]),
    instanceIds.length ? prisma.rSVP.groupBy({ by: ["eventInstanceId", "status"], where: { eventInstanceId: { in: instanceIds } }, _count: { _all: true } }) : Promise.resolve([]),
    uniqueEvents.length ? prisma.rSVP.groupBy({ by: ["eventId"], where: { eventId: { in: uniqueEvents }, status: "CONFIRMED", teamId: { not: null } }, _count: { _all: true } }) : Promise.resolve([]),
    uniqueEvents.length ? prisma.team.groupBy({ by: ["eventId"], where: { eventId: { in: uniqueEvents }, status: "CONFIRMED" }, _count: { _all: true } }) : Promise.resolve([]),
    uniqueEvents.length ? prisma.rSVP.groupBy({ by: ["eventId"], where: { eventId: { in: uniqueEvents }, isCrew: true }, _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const event = tally(eventGroups, "eventId");
  const teamed = new Map(teamedGroups.map((group) => [group.eventId as string, group._count._all]));
  const teams = new Map(teamGroups.map((group) => [group.eventId, group._count._all]));
  const crew = new Map(crewGroups.map((group) => [group.eventId as string, group._count._all]));
  const units = new Map(uniqueEvents.map((id) => [id, (event.get(id)?.confirmed ?? 0) - (crew.get(id) ?? 0) - (teamed.get(id) ?? 0) + (teams.get(id) ?? 0)]));
  return { event, instance: tally(instanceGroups, "eventInstanceId"), units };
}

/** What fills `capacity`: units on a TEAM event, attendees (never crew) otherwise. */
function teamUnits(event: EventForRow, counts: RsvpCounts): { used: number; noun: string } {
  return { used: counts.units.get(event.id) ?? 0, noun: event.registrationMode === "TEAM" ? teamUnitShortNoun(event.soloPolicy) : "going" };
}

export function countsFor(counts: RsvpCounts, eventId: string): CountTriple {
  return counts.event.get(eventId) ?? EMPTY_COUNTS;
}

/**
 * One event row. `canManage` must reflect the person's role in the event's
 * organisation: without it there is no management link and pending
 * approvals are not revealed.
 */
export function toEventRow(event: EventForRow, counts: RsvpCounts, canManage: boolean): HomeEventRow {
  const all = countsFor(counts, event.id);
  const tallies = canManage ? all : { ...all, pending: 0 };
  const units = teamUnits(event, counts);
  const draft = event.status === "DRAFT";
  return {
    key: `event-${event.id}`,
    href: canManage ? `/dashboard/${event.organisation.slug}/event/${event.id}` : null,
    title: event.title,
    organisationName: event.organisation.name,
    dateBlock: { start: event.startDateTime, timezone: event.timezone },
    meta: event.isOnline ? "Online" : event.location || "Venue to be confirmed",
    accent: accentOf(event.page?.accentColor),
    isSeries: false,
    isDraft: draft,
    status: draft ? { label: "Finish & publish", tone: "warning" } : eventFillStatus(tallies, event.capacity, units),
    fill: !draft && event.capacity ? { filled: units.used, total: event.capacity } : null,
  };
}

export const instanceSelect = {
  id: true,
  startDateTime: true,
  series: { select: { id: true, organisationId: true, title: true, timezone: true, capacity: true, organisation: { select: { slug: true, name: true } } } },
} satisfies Prisma.EventInstanceSelect;

export type InstanceForRow = Prisma.EventInstanceGetPayload<{ select: typeof instanceSelect }>;

export function toInstanceRow(instance: InstanceForRow, counts: RsvpCounts, canManage: boolean): HomeEventRow {
  const all = counts.instance.get(instance.id) ?? EMPTY_COUNTS;
  const tallies = canManage ? all : { ...all, pending: 0 };
  return {
    key: `instance-${instance.id}`,
    href: canManage ? `/dashboard/${instance.series.organisation.slug}/series/${instance.series.id}` : null,
    title: instance.series.title,
    organisationName: instance.series.organisation.name,
    dateBlock: { start: instance.startDateTime, timezone: instance.series.timezone },
    meta: "Series date",
    accent: accentOf(null),
    isSeries: true,
    isDraft: false,
    status: eventFillStatus(tallies, instance.series.capacity),
    fill: instance.series.capacity ? { filled: tallies.confirmed, total: instance.series.capacity } : null,
  };
}

/** The Next up card for one event. `canManage` must reflect the person's role in its organisation. */
export async function loadNextUp(event: EventForRow, counts: RsvpCounts, canManage: boolean, now: Date): Promise<NonNullable<DashboardHome["next"]>> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const [signupsLastDay, recent] = await Promise.all([
    prisma.rSVP.count({ where: { eventId: event.id, createdAt: { gte: dayAgo } } }),
    // Named attendees only: anonymous guests are counted but not shown as avatars.
    prisma.rSVP.findMany({
      where: { eventId: event.id, status: "CONFIRMED", OR: [{ guestName: { not: null } }, { user: { name: { not: null } } }] },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { guestName: true, user: { select: { name: true } } },
    }),
  ]);
  return {
    ...toEventRow(event, counts, canManage),
    location: event.isOnline ? "Online" : event.location,
    startDateTime: event.startDateTime,
    timezone: event.timezone,
    confirmed: countsFor(counts, event.id).confirmed,
    capacity: event.capacity,
    capacityUnits: event.registrationMode === "TEAM" ? { used: counts.units.get(event.id) ?? 0, noun: teamUnitNoun(event.soloPolicy, event.capacity ?? 0) } : null,
    signupsLastDay,
    checkInHref: canManage ? `/dashboard/${event.organisation.slug}/event/${event.id}/check-in` : null,
    recentNames: recent.map((rsvp) => displayName(rsvp)).filter((name) => name !== "A guest").map(firstName),
    publicPath: event.status === "PUBLISHED" ? `/${event.organisation.slug}/${event.slug}` : null,
  };
}

/** Where to look for an event that is on now (two hours before start until it ends). */
export function liveEventWhere(base: Prisma.EventWhereInput, now: Date): Prisma.EventWhereInput {
  return { ...base, status: { in: LISTED }, startDateTime: { lte: new Date(now.getTime() + LIVE_LEAD_MS) }, endDateTime: { gte: now } };
}

/** Event-day panel data for one event. `canManage` must reflect the person's role in its organisation. */
export async function loadLiveEvent(event: EventForRow, canManage: boolean, now: Date): Promise<HomeLiveEvent> {
  const start = event.startDateTime;
  const arrivalsStart = new Date(Math.max(start.getTime() - ARRIVAL_BUCKET_MS * 2, Math.min(now.getTime(), event.endDateTime.getTime()) - ARRIVAL_BUCKET_MS * ARRIVAL_BUCKETS));
  const [confirmed, checkedIn, arrivalDates, door, sessions] = await Promise.all([
    prisma.rSVP.count({ where: { eventId: event.id, status: "CONFIRMED" } }),
    prisma.rSVP.count({ where: { eventId: event.id, checkedInAt: { not: null } } }),
    prisma.rSVP.findMany({ where: { eventId: event.id, checkedInAt: { gte: arrivalsStart } }, select: { checkedInAt: true }, take: SAMPLE_LIMIT }),
    prisma.rSVP.findMany({ where: { eventId: event.id, checkedInAt: { not: null } }, orderBy: { checkedInAt: "desc" }, take: 5, select: { id: true, checkedInAt: true, guestName: true, user: { select: { name: true } } } }),
    prisma.eventSession.findMany({ where: { eventId: event.id, visibility: { not: "DRAFT" } }, orderBy: { startDateTime: "asc" }, take: 100, select: { id: true, title: true, startDateTime: true, endDateTime: true, delayMinutes: true } }),
  ]);
  const arrivals = intervalCounts(arrivalDates.flatMap((rsvp) => (rsvp.checkedInAt ? [rsvp.checkedInAt] : [])), arrivalsStart, ARRIVAL_BUCKET_MS, ARRIVAL_BUCKETS);
  const stage = nowAndNext(sessions, now);
  const base = `/dashboard/${event.organisation.slug}/event/${event.id}`;
  return {
    id: event.id,
    title: event.title,
    href: canManage ? base : null,
    checkInHref: canManage ? `${base}/check-in` : null,
    scheduleHref: canManage ? `${base}/schedule` : null,
    timezone: event.timezone,
    location: event.isOnline ? "Online" : event.location,
    startDateTime: start,
    endDateTime: event.endDateTime,
    started: start <= now,
    confirmed,
    checkedIn,
    arrivals: arrivals.map((count, index) => ({ label: new Date(arrivalsStart.getTime() + index * ARRIVAL_BUCKET_MS), count })),
    door: door.map((rsvp) => ({ key: rsvp.id, who: displayName(rsvp), at: rsvp.checkedInAt as Date })),
    onStage: {
      now: stage.now ? { title: stage.now.title, start: stage.now.start, end: stage.now.end } : null,
      next: stage.next ? { title: stage.next.title, start: stage.next.start } : null,
    },
  };
}

export async function getDashboardHome(userId: string, now = new Date()): Promise<DashboardHome> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    orderBy: { organisation: { name: "asc" } },
    select: { role: true, organisation: { select: { id: true, slug: true, name: true, logoUrl: true } } },
  });
  const orgIds = memberships.map((membership) => membership.organisation.id);
  const adminOrgIds = memberships.filter((membership) => isOrgAdmin(membership.role)).map((membership) => membership.organisation.id);
  const adminOrganisations = memberships.filter((membership) => isOrgAdmin(membership.role)).map((membership) => ({ slug: membership.organisation.slug, name: membership.organisation.name }));

  const memberEvent = { organisationId: { in: orgIds } } satisfies Prisma.EventWhereInput;
  const memberRsvp = {
    OR: [{ event: { organisationId: { in: orgIds } } }, { eventInstance: { series: { organisationId: { in: orgIds } } } }],
  } satisfies Prisma.RSVPWhereInput;
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);
  const dayAgo = new Date(now.getTime() - DAY_MS);

  const [
    upcomingEvents,
    upcomingInstances,
    draftEvents,
    pastEvents,
    upcomingEventCount,
    upcomingInstanceCount,
    draftCount,
    pendingRsvps,
    signupDates,
    signupsPrevWeek,
    checkInDates,
    checkInsPrevWeek,
    feedbackDates,
    feedbackPrevWeek,
    recentRsvps,
    recentCheckIns,
    recentFeedback,
    liveCandidate,
    upcomingByOrg,
    membersByOrg,
    anyEvent,
    anyPublished,
    weekAheadEvents,
    weekAheadInstances,
  ] = await Promise.all([
    prisma.event.findMany({ where: { ...memberEvent, status: { in: LISTED }, endDateTime: { gte: now } }, orderBy: { startDateTime: "asc" }, take: LIST_LIMIT, select: eventSelect }),
    prisma.eventInstance.findMany({
      where: { endDateTime: { gte: now }, series: { organisationId: { in: orgIds }, status: { in: LISTED } } },
      orderBy: { startDateTime: "asc" },
      take: LIST_LIMIT,
      select: instanceSelect,
    }),
    prisma.event.findMany({ where: { organisationId: { in: adminOrgIds }, status: "DRAFT" }, orderBy: { createdAt: "desc" }, take: LIST_LIMIT, select: eventSelect }),
    prisma.event.findMany({ where: { ...memberEvent, status: { in: LISTED }, endDateTime: { lt: now } }, orderBy: { startDateTime: "desc" }, take: LIST_LIMIT, select: eventSelect }),
    prisma.event.count({ where: { ...memberEvent, status: { in: LISTED }, endDateTime: { gte: now } } }),
    prisma.eventInstance.count({ where: { endDateTime: { gte: now }, series: { organisationId: { in: orgIds }, status: { in: LISTED } } } }),
    prisma.event.count({ where: { organisationId: { in: adminOrgIds }, status: "DRAFT" } }),
    prisma.rSVP.findMany({
      where: {
        status: "PENDING_APPROVAL",
        OR: [
          { event: { organisationId: { in: adminOrgIds }, endDateTime: { gte: now } } },
          { eventInstance: { endDateTime: { gte: now }, series: { organisationId: { in: adminOrgIds } } } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 500,
      select: { event: { select: { id: true, organisation: { select: { slug: true } } } }, eventInstance: { select: { series: { select: { id: true, organisation: { select: { slug: true } } } } } } },
    }),
    prisma.rSVP.findMany({ where: { ...memberRsvp, createdAt: { gte: weekAgo } }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: SAMPLE_LIMIT }),
    prisma.rSVP.count({ where: { ...memberRsvp, createdAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    prisma.rSVP.findMany({ where: { ...memberRsvp, checkedInAt: { gte: weekAgo } }, select: { checkedInAt: true }, orderBy: { checkedInAt: "desc" }, take: SAMPLE_LIMIT }),
    prisma.rSVP.count({ where: { ...memberRsvp, checkedInAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    prisma.eventFeedbackResponse.findMany({ where: { submittedAt: { gte: weekAgo }, form: { event: memberEvent } }, select: { submittedAt: true }, orderBy: { submittedAt: "desc" }, take: SAMPLE_LIMIT }),
    prisma.eventFeedbackResponse.count({ where: { submittedAt: { gte: twoWeeksAgo, lt: weekAgo }, form: { event: memberEvent } } }),
    prisma.rSVP.findMany({
      where: memberRsvp,
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, status: true, createdAt: true, guestName: true, user: { select: { name: true } }, event: { select: { title: true, timezone: true } }, eventInstance: { select: { series: { select: { title: true, timezone: true } } } } },
    }),
    prisma.rSVP.findMany({
      where: { ...memberRsvp, checkedInAt: { not: null } },
      orderBy: { checkedInAt: "desc" },
      take: 8,
      select: { id: true, checkedInAt: true, guestName: true, user: { select: { name: true } }, event: { select: { title: true, timezone: true } }, eventInstance: { select: { series: { select: { title: true, timezone: true } } } } },
    }),
    prisma.eventFeedbackResponse.findMany({
      where: { form: { event: memberEvent } },
      orderBy: { submittedAt: "desc" },
      take: 8,
      select: { id: true, submittedAt: true, rsvp: { select: { guestName: true, user: { select: { name: true } } } }, form: { select: { event: { select: { title: true, timezone: true } } } } },
    }),
    prisma.event.findFirst({
      where: liveEventWhere(memberEvent, now),
      orderBy: { startDateTime: "asc" },
      select: eventSelect,
    }),
    prisma.event.groupBy({ by: ["organisationId"], where: { ...memberEvent, status: { in: LISTED }, endDateTime: { gte: now } }, _count: { _all: true } }),
    prisma.membership.groupBy({ by: ["organisationId"], where: { organisationId: { in: orgIds } }, _count: { _all: true } }),
    prisma.event.findFirst({ where: memberEvent, select: { id: true } }),
    prisma.event.findFirst({ where: { ...memberEvent, status: { in: LISTED } }, select: { id: true } }),
    prisma.event.findMany({ where: { ...memberEvent, status: { in: LISTED }, startDateTime: { gte: now, lt: new Date(now.getTime() + 7 * DAY_MS) } }, select: { startDateTime: true }, take: 500 }),
    prisma.eventInstance.findMany({ where: { startDateTime: { gte: now, lt: new Date(now.getTime() + 7 * DAY_MS) }, series: { organisationId: { in: orgIds }, status: { in: LISTED } } }, select: { startDateTime: true }, take: 500 }),
  ]);

  // RSVP counts for every event and series date shown in a list.
  const counts = await loadRsvpCounts(
    [...upcomingEvents, ...draftEvents, ...pastEvents].map((event) => event.id),
    upcomingInstances.map((instance) => instance.id),
  );
  const manages = (organisationId: string) => adminOrgIds.includes(organisationId);
  const eventRow = (event: EventForRow) => toEventRow(event, counts, manages(event.organisationId));

  const upcoming = [...upcomingEvents.map(eventRow), ...upcomingInstances.map((instance) => toInstanceRow(instance, counts, manages(instance.series.organisationId)))]
    .sort((a, b) => a.dateBlock.start.getTime() - b.dateBlock.start.getTime())
    .slice(0, LIST_LIMIT);

  // Next up: the soonest one-off event (series dates stay in the list).
  const nextEvent = upcomingEvents.find((event) => event.startDateTime > now) ?? null;
  const next = nextEvent ? await loadNextUp(nextEvent, counts, adminOrgIds.includes(nextEvent.organisationId), now) : null;

  // Event-day mode.
  const live = liveCandidate ? await loadLiveEvent(liveCandidate, adminOrgIds.includes(liveCandidate.organisationId), now) : null;

  // Needs you (managers only).
  const pendingApprovals = pendingRsvps.length;
  const firstPending = pendingRsvps[0];
  const approvalsHref = firstPending?.event
    ? `/dashboard/${firstPending.event.organisation.slug}/event/${firstPending.event.id}`
    : firstPending?.eventInstance
      ? `/dashboard/${firstPending.eventInstance.series.organisation.slug}/series/${firstPending.eventInstance.series.id}`
      : null;
  const firstDraft = draftEvents[0];
  const needsYou = pendingApprovals > 0 || draftCount > 0
    ? { pendingApprovals, approvalsHref, drafts: draftCount, draftHref: firstDraft ? `/dashboard/${firstDraft.organisation.slug}/event/${firstDraft.id}` : null }
    : null;

  // Weekly stats.
  const signupsWeek = dailyCounts(signupDates.map((rsvp) => rsvp.createdAt), now);
  const checkInsWeek = dailyCounts(checkInDates.flatMap((rsvp) => (rsvp.checkedInAt ? [rsvp.checkedInAt] : [])), now);
  const feedbackWeek = dailyCounts(feedbackDates.map((response) => response.submittedAt), now);
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const upcomingTotal = upcomingEventCount + upcomingInstanceCount;
  const nextAny = upcoming[0];
  const stats: HomeStat[] = [
    {
      label: "Upcoming events",
      value: upcomingTotal,
      hint: nextAny ? `Next: ${nextAny.title}` : "Nothing scheduled yet",
      // Dots look ahead: one column per day for the next week.
      levels: toDotLevels(forwardDailyCounts([...weekAheadEvents, ...weekAheadInstances].map((item) => item.startDateTime), now)),
      tone: "ink",
    },
    { label: "Sign-ups this week", value: sum(signupsWeek), hint: weekOverWeek(sum(signupsWeek), signupsPrevWeek) ?? "No sign-ups yet", levels: toDotLevels(signupsWeek), tone: "marigold" },
    { label: "Check-ins this week", value: sum(checkInsWeek), hint: weekOverWeek(sum(checkInsWeek), checkInsPrevWeek) ?? "No check-ins yet", levels: toDotLevels(checkInsWeek), tone: "success" },
    { label: "Feedback this week", value: sum(feedbackWeek), hint: weekOverWeek(sum(feedbackWeek), feedbackPrevWeek) ?? "No responses yet", levels: toDotLevels(feedbackWeek), tone: "amber" },
  ];

  // Activity: sign-ups, check-ins and feedback, newest first.
  const activity: HomeActivity[] = [
    ...recentRsvps.map((rsvp) => ({
      key: `rsvp-${rsvp.id}`,
      kind: (rsvp.status === "WAITLISTED" ? "waitlisted" : rsvp.status === "PENDING_APPROVAL" ? "pending" : "registered") as HomeActivity["kind"],
      who: displayName(rsvp),
      eventTitle: rsvp.event?.title ?? rsvp.eventInstance?.series.title ?? "Event",
      at: rsvp.createdAt,
      timezone: rsvp.event?.timezone ?? rsvp.eventInstance?.series.timezone ?? "UTC",
    })),
    ...recentCheckIns.map((rsvp) => ({
      key: `checkin-${rsvp.id}`,
      kind: "checkedIn" as const,
      who: displayName(rsvp),
      eventTitle: rsvp.event?.title ?? rsvp.eventInstance?.series.title ?? "Event",
      at: rsvp.checkedInAt as Date,
      timezone: rsvp.event?.timezone ?? rsvp.eventInstance?.series.timezone ?? "UTC",
    })),
    ...recentFeedback.map((response) => ({
      key: `feedback-${response.id}`,
      kind: "feedback" as const,
      who: response.rsvp ? displayName(response.rsvp) : "A guest",
      eventTitle: response.form.event.title,
      at: response.submittedAt,
      timezone: response.form.event.timezone,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8);

  const upcomingCount = new Map(upcomingByOrg.map((group) => [group.organisationId, group._count._all]));
  const memberCount = new Map(membersByOrg.map((group) => [group.organisationId, group._count._all]));
  const organisations: HomeOrganisation[] = memberships.map(({ role, organisation }) => ({
    ...organisation,
    role: role === "OWNER" ? "Owner" : role === "ADMIN" ? "Admin" : "Member",
    upcoming: upcomingCount.get(organisation.id) ?? 0,
    members: memberCount.get(organisation.id) ?? 0,
  }));

  // First run: shown until the person has a published event.
  const setupDone = Boolean(anyPublished);
  const canSetUp = memberships.length === 0 || adminOrgIds.length > 0;
  const setup = !setupDone && canSetUp
    ? {
        hasOrganisation: memberships.length > 0,
        hasLogo: memberships.some((membership) => isOrgAdmin(membership.role) && membership.organisation.logoUrl),
        hasEvent: Boolean(anyEvent),
        hasPublished: false,
        firstAdminSlug: adminOrganisations[0]?.slug ?? null,
      }
    : null;

  const signupsLastDay = signupDates.filter((rsvp) => rsvp.createdAt >= dayAgo).length;
  const summary = homeSummary({
    live: live ? { title: live.title } : null,
    next: nextAny ? { title: nextAny.title, startDateTime: nextAny.dateBlock.start, timezone: nextAny.dateBlock.timezone } : null,
    signupsLastDay,
    now,
  });

  return {
    summary,
    mood: live ? "cheering" : upcomingTotal > 0 ? "happy" : "sleepy",
    organisations,
    adminOrganisations,
    needsYou,
    next,
    stats,
    upcoming,
    drafts: draftEvents.map(eventRow),
    past: pastEvents.map(eventRow),
    counts: { upcoming: upcomingTotal, drafts: draftCount },
    activity,
    live,
    setup,
  };
}

/** Pending approvals per organisation the person manages, for the sidebar badges. */
export async function getPendingApprovalsByOrg(adminOrgIds: string[], now = new Date()): Promise<Map<string, number>> {
  if (adminOrgIds.length === 0) return new Map();
  const [events, instances] = await Promise.all([
    prisma.event.findMany({
      where: { organisationId: { in: adminOrgIds }, endDateTime: { gte: now }, rsvps: { some: { status: "PENDING_APPROVAL" } } },
      select: { organisationId: true, _count: { select: { rsvps: { where: { status: "PENDING_APPROVAL" } } } } },
      take: 500,
    }),
    prisma.eventInstance.findMany({
      where: { endDateTime: { gte: now }, series: { organisationId: { in: adminOrgIds } }, rsvps: { some: { status: "PENDING_APPROVAL" } } },
      select: { series: { select: { organisationId: true } }, _count: { select: { rsvps: { where: { status: "PENDING_APPROVAL" } } } } },
      take: 500,
    }),
  ]);
  const totals = new Map<string, number>();
  for (const event of events) totals.set(event.organisationId, (totals.get(event.organisationId) ?? 0) + event._count.rsvps);
  for (const instance of instances) totals.set(instance.series.organisationId, (totals.get(instance.series.organisationId) ?? 0) + instance._count.rsvps);
  return totals;
}
