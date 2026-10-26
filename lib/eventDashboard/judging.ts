import "server-only";

import type { EventStatus, JudgingStatus, ScoreNormalization, SubmissionStatus } from "@prisma/client";
import {
  countResultsAnnouncementRecipients,
  listSubmissionsForOrganiser,
  loadJudgeProgress,
  loadJudgingResultsPage,
  loadJudgingSetup,
  type AwardCandidateDto,
  type JudgeProgressRowDto,
  type JudgingResultsPageDto,
  type OrganiserSubmissionsPage,
  type ResultRowDto,
} from "@/lib/core/judging";
import { countUnsubmittedEntrants, type UnsubmittedEntrantsPage } from "@/lib/core/judgingEntrants";
import type { JudgingOrganiserContext } from "@/lib/judgingAccess";
import type { ResultsScoreFilter } from "@/lib/judgingOrganiserPaging";
import { prisma } from "@/lib/db";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { safeTimeZone, zonedDatetimeLocalValue } from "@/lib/timeZone";
import { resultsPath } from "@/lib/submissionToken";
import { needsAnnouncementCount } from "@/lib/hackathonEmails";

/*
 * Organiser data for the event dashboard's Judging tab (docs/HACKATHON.md).
 * Callers must have checked `ctx.permissions.canManageJudging` (organisation
 * OWNER/ADMIN, the same check as the organiser RSVP actions). Everything is
 * read through the lib/core/judging.ts read models and serialised for client
 * components: dates become ISO strings, and no entrant email, ticket link or
 * token is ever included. Judges' emails are shown to organisers, who already
 * see them in the collaborator list.
 */

export type JudgingDashboardSettings = {
  submissionsEnabled: boolean;
  /** `datetime-local` values in the event timezone ("" when unset). */
  opensAtLocal: string;
  closesAtLocal: string;
  opensAt: string | null;
  closesAt: string | null;
  judgingStatus: JudgingStatus;
  judgesSeeAll: boolean;
  projectGalleryPublic: boolean;
  resultsPublishedAt: string | null;
  /** Set once entrants were emailed the results (lib/hackathonEmails.ts). */
  resultsAnnouncedAt: string | null;
  /** Hackathon email switches, both off by default. */
  emailEntrantsOnResults: boolean;
  emailSubmissionReceipts: boolean;
  timezone: string;
  /** Entrants only reach the submission form on a PUBLISHED event; the panels warn otherwise. */
  eventStatus: EventStatus;
};

export type JudgingDashboardCriterion = { id: string; name: string; description: string; weight: number; maxScore: number };

export type JudgingDashboardAward = {
  id: string;
  name: string;
  description: string;
  winners: Array<{ place: number; submissionId: string; title: string; entrantName: string }>;
};

export type JudgingDashboardSubmission = {
  id: string;
  title: string;
  summary: string;
  entrantName: string;
  isTeam: boolean;
  repoUrl: string | null;
  demoUrl: string | null;
  videoUrl: string | null;
  status: SubmissionStatus;
  submittedAt: string | null;
  updatedAt: string;
  disqualifiedReason: string | null;
  assignedJudgeIds: string[];
};

export type JudgingDashboardResultRow = {
  submissionId: string;
  title: string;
  entrantName: string;
  status: SubmissionStatus;
  /** The active method's score, which ranks. */
  score: number | null;
  rawScore: number | null;
  adjustedScore: number | null;
  judgesCounted: number;
  rank: number | null;
  criterionAverages: Array<{ criterionId: string; average: number | null }>;
};

/** One "Load more" page of Judging → Submissions (bounded; see lib/judgingOrganiserPaging.ts). */
export type JudgingDashboardSubmissionsPage = {
  submissions: JudgingDashboardSubmission[];
  nextCursor: string | null;
};

/** Judging → Submissions → Not submitted: one entrant without a SUBMITTED project. */
export type JudgingDashboardUnsubmittedEntrant = {
  kind: "team" | "solo";
  id: string;
  name: string;
  size: number;
  submissionStatus: SubmissionStatus | null;
  submissionTitle: string | null;
  registeredAt: string;
};

export type JudgingDashboardUnsubmittedPage = {
  entrants: JudgingDashboardUnsubmittedEntrant[];
  nextCursor: string | null;
};

export function toDashboardUnsubmittedPage(page: UnsubmittedEntrantsPage): JudgingDashboardUnsubmittedPage {
  return {
    entrants: page.entrants.map((row) => ({
      kind: row.kind,
      id: row.id,
      name: row.name,
      size: row.size,
      submissionStatus: row.submissionStatus,
      submissionTitle: row.submissionTitle,
      registeredAt: row.registeredAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  };
}

/** One numbered page of the ranked table; ranks are computed over every project. */
export type JudgingDashboardResultsPage = {
  rows: JudgingDashboardResultRow[];
  page: number;
  totalPages: number;
  /** Rows matching the search across every page. */
  total: number;
  /** 0-based index of this page's first row. */
  start: number;
  pageSize: number;
  query: string;
  /** Rows in the whole ranking, before any search. */
  rankedTotal: number;
  /** Which score ranks: RAW, or ZSCORE ("Adjust for harsh/generous judges"). */
  scoreNormalization: ScoreNormalization;
  /** The score filter applied ("all" for none). */
  scored: ResultsScoreFilter;
  /** Rows per score filter over the whole ranking, for the chips. */
  scoreCounts: Record<ResultsScoreFilter, number>;
};

/** A project the Awards winner picker offers (SUBMITTED only). */
export type JudgingDashboardAwardCandidate = AwardCandidateDto;

export type JudgingDashboardJudge = JudgeProgressRowDto;

export type JudgingDashboardData = {
  scope: { organisationSlug: string; eventId: string };
  settings: JudgingDashboardSettings;
  criteria: JudgingDashboardCriterion[];
  awards: JudgingDashboardAward[];
  /** Projects per status over the whole event (the Submissions chips and tab count). */
  counts: Record<SubmissionStatus, number>;
  /** Every project of the event, whatever its status. */
  submissionsTotal: number;
  /** Confirmed teams and solo registrants without a SUBMITTED project (the "Not submitted" chip). */
  unsubmittedCount: number;
  /** The first page of Judging → Submissions; further pages come from `loadSubmissionsPage`. */
  submissions: JudgingDashboardSubmissionsPage;
  judges: JudgingDashboardJudge[];
  /** The first page of the ranked table; other pages come from `loadResultsPage`. */
  results: JudgingDashboardResultsPage;
  exportHref: string;
  resultsUrl: string;
  /** How many entrants a results announcement would email now (publish and "Send results email now" dialogs). */
  announcementRecipients: number;
};

/** The organiser context for judging cores, built from the already-resolved dashboard context. */
export function judgingOrganiserContext(ctx: EventDashboardContext): JudgingOrganiserContext | null {
  if (!ctx.permissions.canManageJudging) return null;
  return {
    userId: ctx.userId,
    organisationId: ctx.organisation.id,
    orgSlug: ctx.organisation.slug,
    eventId: ctx.event.id,
    eventSlug: ctx.event.slug,
  };
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

type JudgingSetup = NonNullable<Awaited<ReturnType<typeof loadJudgingSetup>>>;

function settingsView(settings: JudgingSetup["settings"], eventStatus: EventStatus): JudgingDashboardSettings {
  const timezone = safeTimeZone(settings.timezone);
  return {
    submissionsEnabled: settings.submissionsEnabled,
    opensAtLocal: settings.submissionsOpenAt ? zonedDatetimeLocalValue(settings.submissionsOpenAt, timezone) : "",
    closesAtLocal: settings.submissionsCloseAt ? zonedDatetimeLocalValue(settings.submissionsCloseAt, timezone) : "",
    opensAt: iso(settings.submissionsOpenAt),
    closesAt: iso(settings.submissionsCloseAt),
    judgingStatus: settings.judgingStatus,
    judgesSeeAll: settings.judgesSeeAll,
    projectGalleryPublic: settings.projectGalleryPublic,
    resultsPublishedAt: iso(settings.resultsPublishedAt),
    resultsAnnouncedAt: iso(settings.resultsAnnouncedAt),
    emailEntrantsOnResults: settings.emailEntrantsOnResults,
    emailSubmissionReceipts: settings.emailSubmissionReceipts,
    timezone,
    eventStatus,
  };
}

/**
 * Whether this event uses judging: submissions are on, or there is judging
 * state left to manage (projects, a started judging round, published results).
 * The dashboard shows the Judging tab only then, so ordinary events keep the
 * eight tabs of docs/DESIGN.md; until then owners and admins turn submissions
 * on from the Settings tab (`loadJudgingSettingsCard`).
 */
export async function eventUsesJudging(ctx: EventDashboardContext): Promise<boolean> {
  const { event } = ctx;
  if (event.submissionsEnabled || event.judgingStatus !== "NOT_STARTED" || event.resultsPublishedAt) return true;
  return Boolean(await prisma.submission.findFirst({ where: { eventId: event.id }, select: { id: true } }));
}

/** The submissions settings alone, for the Settings tab card. Null without permission. */
export async function loadJudgingSettingsCard(
  ctx: EventDashboardContext,
): Promise<{ scope: JudgingDashboardData["scope"]; settings: JudgingDashboardSettings } | null> {
  const organiser = judgingOrganiserContext(ctx);
  if (!organiser) return null;
  const setup = await loadJudgingSetup(organiser);
  if (!setup) return null;
  return { scope: { organisationSlug: ctx.organisation.slug, eventId: ctx.event.id }, settings: settingsView(setup.settings, ctx.event.status) };
}

export function toDashboardSubmissionsPage(page: OrganiserSubmissionsPage): JudgingDashboardSubmissionsPage {
  return {
    submissions: page.submissions.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      entrantName: row.entrantName,
      isTeam: row.isTeam,
      repoUrl: row.repoUrl,
      demoUrl: row.demoUrl,
      videoUrl: row.videoUrl,
      status: row.status,
      submittedAt: iso(row.submittedAt),
      updatedAt: row.updatedAt.toISOString(),
      disqualifiedReason: row.disqualifiedReason,
      assignedJudgeIds: row.assignedJudgeIds,
    })),
    nextCursor: page.nextCursor,
  };
}

function toDashboardResultRow(row: ResultRowDto): JudgingDashboardResultRow {
  return {
    submissionId: row.submissionId,
    title: row.title,
    entrantName: row.entrantName,
    status: row.status,
    score: row.score,
    rawScore: row.rawScore,
    adjustedScore: row.adjustedScore,
    judgesCounted: row.judgesCounted,
    rank: row.rank,
    criterionAverages: row.criterionAverages.map((average) => ({ ...average })),
  };
}

export function toDashboardResultsPage(page: JudgingResultsPageDto): JudgingDashboardResultsPage {
  return {
    rows: page.rows.map(toDashboardResultRow),
    page: page.page,
    totalPages: page.totalPages,
    total: page.total,
    start: page.start,
    pageSize: page.pageSize,
    query: page.query,
    rankedTotal: page.rankedTotal,
    scoreNormalization: page.scoreNormalization,
    scored: page.scored,
    scoreCounts: { ...page.scoreCounts },
  };
}

/**
 * Everything the organiser Judging tab renders, bounded: the first page of
 * submissions and of the ranked table, per-status counts and per-judge
 * progress from aggregates. Null without permission or when the event is gone.
 */
export async function loadJudgingDashboard(ctx: EventDashboardContext): Promise<JudgingDashboardData | null> {
  const organiser = judgingOrganiserContext(ctx);
  if (!organiser) return null;
  const [setup, submissions, judges, results, unsubmittedCount] = await Promise.all([
    loadJudgingSetup(organiser),
    listSubmissionsForOrganiser(organiser),
    loadJudgeProgress(organiser),
    loadJudgingResultsPage(organiser),
    countUnsubmittedEntrants(organiser),
  ]);
  if (!setup || !judges || !results) return null;
  // The recipient count scans the outbox, so it only runs when a dialog will
  // show it: the switch is on and the current publication isn't announced.
  const announcementRecipients = needsAnnouncementCount(setup.settings) ? await countResultsAnnouncementRecipients(organiser) : 0;

  return {
    scope: { organisationSlug: ctx.organisation.slug, eventId: ctx.event.id },
    settings: settingsView(setup.settings, ctx.event.status),
    criteria: setup.criteria.map((criterion) => ({ ...criterion })),
    awards: setup.awards.map((award) => ({ ...award, winners: award.winners.map((winner) => ({ ...winner })) })),
    counts: setup.counts,
    submissionsTotal: Object.values(setup.counts).reduce((sum, count) => sum + count, 0),
    unsubmittedCount,
    submissions: toDashboardSubmissionsPage(submissions),
    judges: judges.map((judge) => ({ ...judge })),
    results: toDashboardResultsPage(results),
    exportHref: `/api/exports/events/${ctx.event.id}/judging`,
    resultsUrl: `${ctx.origin}${resultsPath(ctx.organisation.slug, ctx.event.slug)}`,
    announcementRecipients: announcementRecipients ?? 0,
  };
}
