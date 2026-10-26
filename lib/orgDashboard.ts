import "server-only";

import type { EventPrivacyType, MembershipRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { cachedDateTimeFormat } from "@/lib/format/intlCache";
import {
  countsFor,
  eventSelect,
  liveEventWhere,
  loadLiveEvent,
  loadNextUp,
  loadRsvpCounts,
  toEventRow,
  type DashboardHome,
  type HomeEventRow,
  type HomeLiveEvent,
  type HomeStat,
} from "@/lib/dashboardHome";
import { monthGrid, monthKey, parseMonth, shiftMonth, toDotLevels, turnout, weekOverWeek, windowCounts } from "@/lib/dashboardHomeMetrics";
import { describeRecurrence } from "@/lib/format/recurrence";
import { getAccentTokens } from "@/lib/theme/accent";
import { safeTimeZone } from "@/lib/timeZone";

/*
 * Data for one organisation's workspace (app/dashboard/[orgSlug]/page.tsx).
 * Every query is scoped to this organisation. Action prompts (approvals,
 * drafts, check-in) are only built when the caller says the person can
 * manage events; ordinary members get the read-only parts.
 */

const DAY_MS = 86_400_000;
const PAGE_SIZE = 8;
const SAMPLE_LIMIT = 5000;
const LISTED = ["PUBLISHED", "HIDDEN"] as const;

export type OrgEventView = "upcoming" | "draft" | "past";

export type OrgEventRow = HomeEventRow & {
  privacy: string;
  publicPath: string | null;
  checkInHref: string | null;
  linkable: boolean;
  /** Past events: "34 of 40 came" and feedback responses. */
  outcome: { came: number; going: number; feedback: number } | null;
};

export type OrgSeriesCard = { id: string; title: string; rule: string; isDraft: boolean; next: { start: Date; timezone: string; going: number } | null };

export type OrgCalendar = {
  label: string;
  prevKey: string;
  nextKey: string;
  cells: Array<{ day: number | null; dots: string[]; today: boolean }>;
  events: number;
  seriesDates: number;
};

export type OrgDashboard = {
  members: { total: number; owners: number; admins: number; members: number; initials: string[] };
  needsYou: DashboardHome["needsYou"];
  next: DashboardHome["next"];
  live: HomeLiveEvent | null;
  calendar: OrgCalendar;
  stats: HomeStat[];
  events: { view: OrgEventView; rows: OrgEventRow[]; total: number; hasMore: boolean; counts: { upcoming: number; draft: number; past: number } };
  series: { cards: OrgSeriesCard[]; total: number };
  setup: { hasProfile: boolean; hasEvent: boolean; hasTeam: boolean; hasPublished: boolean } | null;
};

const PRIVACY_LABELS: Record<EventPrivacyType, string> = {
  PUBLIC: "Public",
  HIDDEN_LINK: "Hidden link",
  APPROVAL_REQUIRED: "Approval required",
  INVITE_ONLY: "Invite only",
};

const ROLE_LABELS: Record<MembershipRole, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };

export function roleLabel(role: MembershipRole) {
  return ROLE_LABELS[role];
}

/** "2026-10-15" for an instant in a timezone. */
function localDay(date: Date, timeZone: string) {
  return cachedDateTimeFormat("en-CA", { timeZone: safeTimeZone(timeZone), year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function initialsOf(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export async function getOrgDashboard(input: {
  organisation: { id: string; slug: string; logoUrl: string | null; description: string };
  canManage: boolean;
  view: OrgEventView;
  query: string;
  pages: number;
  month: string | undefined;
  now?: Date;
}): Promise<OrgDashboard> {
  const { organisation, canManage } = input;
  const now = input.now ?? new Date();
  const orgEvent = { organisationId: organisation.id } satisfies Prisma.EventWhereInput;
  const orgRsvp = {
    OR: [{ event: { organisationId: organisation.id } }, { eventInstance: { series: { organisationId: organisation.id } } }],
  } satisfies Prisma.RSVPWhereInput;
  const view: OrgEventView = !canManage && input.view === "draft" ? "upcoming" : input.view;
  const search = input.query.trim().slice(0, 100);
  const titleFilter = search ? { title: { contains: search, mode: "insensitive" as const } } : {};
  const viewWhere: Record<OrgEventView, Prisma.EventWhereInput> = {
    upcoming: { ...orgEvent, status: { in: [...LISTED] }, endDateTime: { gte: now } },
    draft: { ...orgEvent, status: "DRAFT" },
    past: { ...orgEvent, status: { in: [...LISTED] }, endDateTime: { lt: now } },
  };
  const take = PAGE_SIZE * Math.min(Math.max(input.pages, 1), 20);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS);

  const [
    roleGroups,
    teamSample,
    listed,
    listTotal,
    upcomingCount,
    draftCount,
    pastCount,
    upcomingInstanceCount,
    weekAheadCount,
    nextEvent,
    liveCandidate,
    pendingRsvps,
    firstDraft,
    signupDates,
    signupsPrevious,
    feedbackDates,
    feedbackEventsCount,
    recentPast,
    seriesList,
    seriesTotal,
    anyEvent,
    anyPublished,
    latestTimezone,
  ] = await Promise.all([
    prisma.membership.groupBy({ by: ["role"], where: { organisationId: organisation.id }, _count: { _all: true } }),
    prisma.membership.findMany({ where: { organisationId: organisation.id }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], take: 6, select: { user: { select: { name: true } } } }),
    prisma.event.findMany({
      where: { ...viewWhere[view], ...titleFilter },
      orderBy: view === "past" ? { startDateTime: "desc" } : view === "draft" ? { createdAt: "desc" } : { startDateTime: "asc" },
      take,
      select: { ...eventSelect, privacyType: true },
    }),
    prisma.event.count({ where: { ...viewWhere[view], ...titleFilter } }),
    prisma.event.count({ where: viewWhere.upcoming }),
    canManage ? prisma.event.count({ where: viewWhere.draft }) : Promise.resolve(0),
    prisma.event.count({ where: viewWhere.past }),
    prisma.eventInstance.count({ where: { endDateTime: { gte: now }, series: { organisationId: organisation.id, status: { in: [...LISTED] } } } }),
    prisma.event.count({ where: { ...orgEvent, status: { in: [...LISTED] }, startDateTime: { gte: now, lt: new Date(now.getTime() + 7 * DAY_MS) } } }),
    prisma.event.findFirst({ where: { ...orgEvent, status: { in: [...LISTED] }, startDateTime: { gt: now } }, orderBy: { startDateTime: "asc" }, select: eventSelect }),
    prisma.event.findFirst({ where: liveEventWhere(orgEvent, now), orderBy: { startDateTime: "asc" }, select: eventSelect }),
    canManage
      ? prisma.rSVP.findMany({
          where: {
            status: "PENDING_APPROVAL",
            OR: [
              { event: { organisationId: organisation.id, endDateTime: { gte: now } } },
              { eventInstance: { endDateTime: { gte: now }, series: { organisationId: organisation.id } } },
            ],
          },
          orderBy: { createdAt: "asc" },
          take: 500,
          select: { event: { select: { id: true } }, eventInstance: { select: { series: { select: { id: true } } } } },
        })
      : Promise.resolve([]),
    canManage ? prisma.event.findFirst({ where: viewWhere.draft, orderBy: { createdAt: "desc" }, select: { id: true } }) : Promise.resolve(null),
    prisma.rSVP.findMany({ where: { ...orgRsvp, createdAt: { gte: thirtyDaysAgo } }, select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: SAMPLE_LIMIT }),
    prisma.rSVP.count({ where: { ...orgRsvp, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
    prisma.eventFeedbackResponse.findMany({ where: { submittedAt: { gte: thirtyDaysAgo }, form: { event: orgEvent } }, select: { submittedAt: true }, orderBy: { submittedAt: "desc" }, take: SAMPLE_LIMIT }),
    prisma.event.count({ where: { ...orgEvent, feedbackForm: { responses: { some: { submittedAt: { gte: thirtyDaysAgo } } } } } }),
    prisma.event.findMany({ where: viewWhere.past, orderBy: { endDateTime: "desc" }, take: 5, select: { id: true } }),
    prisma.eventSeries.findMany({
      where: { organisationId: organisation.id, ...(canManage ? {} : { status: { in: [...LISTED] } }) },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        title: true,
        recurrenceRule: true,
        status: true,
        timezone: true,
        instances: { where: { startDateTime: { gte: now } }, orderBy: { startDateTime: "asc" }, take: 1, select: { id: true, startDateTime: true } },
      },
    }),
    prisma.eventSeries.count({ where: { organisationId: organisation.id, ...(canManage ? {} : { status: { in: [...LISTED] } }) } }),
    prisma.event.findFirst({ where: orgEvent, select: { id: true } }),
    prisma.event.findFirst({ where: { ...orgEvent, status: "PUBLISHED" }, select: { id: true } }),
    prisma.event.findFirst({ where: orgEvent, orderBy: { startDateTime: "desc" }, select: { timezone: true } }),
  ]);

  // RSVP counts for listed events, Next up and turnout in one pass.
  const pastIds = recentPast.map((event) => event.id);
  const counts = await loadRsvpCounts([...listed.map((event) => event.id), ...(nextEvent ? [nextEvent.id] : []), ...pastIds], []);
  const outcomeIds = view === "past" ? listed.map((event) => event.id) : [];
  const [checkInGroups, feedbackForms, nextInstanceGoing] = await Promise.all([
    [...pastIds, ...outcomeIds].length
      ? prisma.rSVP.groupBy({ by: ["eventId"], where: { eventId: { in: [...new Set([...pastIds, ...outcomeIds])] }, checkedInAt: { not: null } }, _count: { _all: true } })
      : Promise.resolve([]),
    outcomeIds.length ? prisma.eventFeedbackForm.findMany({ where: { eventId: { in: outcomeIds } }, select: { eventId: true, _count: { select: { responses: true } } } }) : Promise.resolve([]),
    (() => {
      const ids = seriesList.flatMap((series) => series.instances.map((instance) => instance.id));
      return ids.length ? prisma.rSVP.groupBy({ by: ["eventInstanceId"], where: { eventInstanceId: { in: ids }, status: "CONFIRMED" }, _count: { _all: true } }) : Promise.resolve([]);
    })(),
  ]);
  const checkedInBy = new Map(checkInGroups.map((group) => [group.eventId as string, group._count._all]));
  const feedbackBy = new Map(feedbackForms.map((form) => [form.eventId, form._count.responses]));
  const goingByInstance = new Map(nextInstanceGoing.map((group) => [group.eventInstanceId as string, group._count._all]));

  const rows: OrgEventRow[] = listed.map((event) => {
    const base = toEventRow(event, counts, canManage);
    const isUpcoming = event.status !== "DRAFT" && event.endDateTime >= now;
    const going = countsFor(counts, event.id).confirmed;
    return {
      ...base,
      privacy: PRIVACY_LABELS[event.privacyType],
      publicPath: event.status === "PUBLISHED" ? `/${organisation.slug}/${event.slug}` : null,
      checkInHref: canManage && isUpcoming && base.href ? `${base.href}/check-in` : null,
      linkable: base.href != null,
      outcome: view === "past" ? { came: Math.min(checkedInBy.get(event.id) ?? 0, going), going, feedback: feedbackBy.get(event.id) ?? 0 } : null,
    };
  });

  // Next up and event day, scoped to this organisation.
  const [next, live] = await Promise.all([
    nextEvent ? loadNextUp(nextEvent, counts, canManage, now) : Promise.resolve(null),
    liveCandidate ? loadLiveEvent(liveCandidate, canManage, now) : Promise.resolve(null),
  ]);

  // Needs you.
  const firstPending = pendingRsvps[0];
  const approvalsHref = firstPending?.event
    ? `/dashboard/${organisation.slug}/event/${firstPending.event.id}`
    : firstPending?.eventInstance
      ? `/dashboard/${organisation.slug}/series/${firstPending.eventInstance.series.id}`
      : null;
  const needsYou = canManage && (pendingRsvps.length > 0 || draftCount > 0)
    ? { pendingApprovals: pendingRsvps.length, approvalsHref, drafts: draftCount, draftHref: firstDraft ? `/dashboard/${organisation.slug}/event/${firstDraft.id}` : null }
    : null;

  // Calendar for the requested month (defaults to this month in the organisation's usual timezone).
  const calendarZone = latestTimezone?.timezone ?? "UTC";
  const [todayYear, todayMonth] = localDay(now, calendarZone).split("-").map(Number);
  const month = parseMonth(input.month, { year: todayYear, month: todayMonth });
  const rangeStart = new Date(Date.UTC(month.year, month.month - 1, 1) - DAY_MS);
  const rangeEnd = new Date(Date.UTC(month.year, month.month, 1) + DAY_MS);
  const [monthEvents, monthInstances] = await Promise.all([
    prisma.event.findMany({ where: { ...orgEvent, status: { in: [...LISTED] }, startDateTime: { gte: rangeStart, lt: rangeEnd } }, select: { startDateTime: true, timezone: true, page: { select: { accentColor: true } } }, take: 300 }),
    prisma.eventInstance.findMany({ where: { startDateTime: { gte: rangeStart, lt: rangeEnd }, series: { organisationId: organisation.id, status: { in: [...LISTED] } } }, select: { startDateTime: true, series: { select: { timezone: true } } }, take: 300 }),
  ]);
  const prefix = `${monthKey(month)}-`;
  const dotsByDay = new Map<number, string[]>();
  let monthEventCount = 0;
  let monthSeriesCount = 0;
  const addDot = (date: Date, zone: string, color: string) => {
    const day = localDay(date, zone);
    if (!day.startsWith(prefix)) return false;
    const number = Number(day.slice(prefix.length));
    dotsByDay.set(number, [...(dotsByDay.get(number) ?? []), color].slice(0, 3));
    return true;
  };
  for (const event of monthEvents) if (addDot(event.startDateTime, event.timezone, getAccentTokens(event.page?.accentColor, "light")["--yy-accent"])) monthEventCount += 1;
  for (const instance of monthInstances) if (addDot(instance.startDateTime, instance.series.timezone, "var(--yy-text-muted)")) monthSeriesCount += 1;
  const todayKey = localDay(now, calendarZone);
  const calendar: OrgCalendar = {
    label: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(month.year, month.month - 1, 15))),
    prevKey: monthKey(shiftMonth(month, -1)),
    nextKey: monthKey(shiftMonth(month, 1)),
    cells: monthGrid(month).map((day) => ({ day, dots: day ? dotsByDay.get(day) ?? [] : [], today: day != null && `${prefix}${String(day).padStart(2, "0")}` === todayKey })),
    events: monthEventCount,
    seriesDates: monthSeriesCount,
  };

  // Stats.
  const fiveDays = 5 * DAY_MS;
  const signupBuckets = windowCounts(signupDates.map((rsvp) => rsvp.createdAt), now, 6, fiveDays);
  const feedbackBuckets = windowCounts(feedbackDates.map((response) => response.submittedAt), now, 6, fiveDays);
  const pastTurnout = turnout([...pastIds].reverse().map((id) => ({ confirmed: countsFor(counts, id).confirmed, checkedIn: checkedInBy.get(id) ?? 0 })));
  const signups = signupDates.length;
  const stats: HomeStat[] = [
    { label: "Upcoming events", value: upcomingCount + upcomingInstanceCount, hint: weekAheadCount > 0 ? `${weekAheadCount} in the next 7 days` : "None in the next 7 days", levels: [], tone: "ink" },
    { label: "Sign-ups, 30 days", value: signups, hint: weekOverWeek(signups, signupsPrevious, { previous: "the 30 days before", current: "this month" }) ?? "No sign-ups yet", levels: toDotLevels(signupBuckets), tone: "marigold" },
    {
      label: "Turnout",
      value: pastTurnout.percent == null ? "—" : `${pastTurnout.percent}%`,
      hint: pastTurnout.percent == null ? "Shows after your first event" : `Checked in of going, last ${pastIds.length} event${pastIds.length === 1 ? "" : "s"}`,
      levels: pastTurnout.levels,
      tone: "success",
    },
    { label: "Feedback, 30 days", value: feedbackDates.length, hint: feedbackEventsCount > 0 ? `Across ${feedbackEventsCount} event${feedbackEventsCount === 1 ? "" : "s"}` : "No responses yet", levels: toDotLevels(feedbackBuckets), tone: "amber" },
  ];

  // Series.
  const cards: OrgSeriesCard[] = seriesList.map((series) => {
    const instance = series.instances[0];
    return {
      id: series.id,
      title: series.title,
      rule: describeRecurrence(series.recurrenceRule),
      isDraft: series.status === "DRAFT",
      next: instance ? { start: instance.startDateTime, timezone: series.timezone, going: goingByInstance.get(instance.id) ?? 0 } : null,
    };
  });

  // Team.
  const roleCount = (role: MembershipRole) => roleGroups.find((group) => group.role === role)?._count._all ?? 0;
  const members = {
    total: roleGroups.reduce((sum, group) => sum + group._count._all, 0),
    owners: roleCount("OWNER"),
    admins: roleCount("ADMIN"),
    members: roleCount("MEMBER"),
    initials: teamSample.map((membership) => initialsOf(membership.user.name)),
  };

  const setup = canManage && !anyPublished
    ? { hasProfile: Boolean(organisation.logoUrl && organisation.description.trim()), hasEvent: Boolean(anyEvent), hasTeam: members.total > 1, hasPublished: false }
    : null;

  return {
    members,
    needsYou,
    next,
    live,
    calendar,
    stats,
    events: { view, rows, total: listTotal, hasMore: listTotal > rows.length, counts: { upcoming: upcomingCount, draft: draftCount, past: pastCount } },
    series: { cards, total: seriesTotal },
    setup,
  };
}

