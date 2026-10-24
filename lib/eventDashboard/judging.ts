import "server-only";

import type { JudgingStatus, SubmissionStatus } from "@prisma/client";
import {
  listEligibleJudges,
  listSubmissionsForOrganiser,
  loadJudgingResults,
  loadJudgingSetup,
  type EligibleJudgeDto,
} from "@/lib/core/judging";
import type { JudgingOrganiserContext } from "@/lib/judgingAccess";
import { prisma } from "@/lib/db";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { safeTimeZone, zonedDatetimeLocalValue } from "@/lib/timeZone";
import { resultsPath } from "@/lib/submissionToken";

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
  timezone: string;
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
  score: number | null;
  judgesCounted: number;
  rank: number | null;
  criterionAverages: Array<{ criterionId: string; average: number | null }>;
};

export type JudgingDashboardJudge = EligibleJudgeDto & {
  /** Submissions this judge can see (assignment rule and conflicts applied); null before anyone is counted. */
  visible: number | null;
  reviewsSubmitted: number;
  assigned: number;
};

export type JudgingDashboardData = {
  scope: { organisationSlug: string; eventId: string };
  settings: JudgingDashboardSettings;
  criteria: JudgingDashboardCriterion[];
  awards: JudgingDashboardAward[];
  counts: Record<SubmissionStatus, number>;
  submissions: JudgingDashboardSubmission[];
  judges: JudgingDashboardJudge[];
  results: JudgingDashboardResultRow[];
  exportHref: string;
  resultsUrl: string;
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

function settingsView(settings: JudgingSetup["settings"]): JudgingDashboardSettings {
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
    timezone,
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
  return { scope: { organisationSlug: ctx.organisation.slug, eventId: ctx.event.id }, settings: settingsView(setup.settings) };
}

/** Everything the organiser Judging tab renders. Null without permission or when the event is gone. */
export async function loadJudgingDashboard(ctx: EventDashboardContext): Promise<JudgingDashboardData | null> {
  const organiser = judgingOrganiserContext(ctx);
  if (!organiser) return null;
  const [setup, submissions, eligible, results] = await Promise.all([
    loadJudgingSetup(organiser),
    listSubmissionsForOrganiser(organiser),
    listEligibleJudges(organiser),
    loadJudgingResults(organiser),
  ]);
  if (!setup || !results) return null;

  const progress = new Map(results.judges.map((judge) => [judge.userId, judge]));
  const assignedCount = new Map<string, number>();
  for (const submission of submissions) {
    for (const judgeId of submission.assignedJudgeIds) assignedCount.set(judgeId, (assignedCount.get(judgeId) ?? 0) + 1);
  }
  const judges: JudgingDashboardJudge[] = eligible.map((judge) => ({
    ...judge,
    visible: progress.get(judge.userId)?.visible ?? null,
    reviewsSubmitted: progress.get(judge.userId)?.reviewsSubmitted ?? 0,
    assigned: assignedCount.get(judge.userId) ?? 0,
  }));
  // A judge whose grant was revoked after scoring stays listed for the record; their reviews no longer count.
  for (const judge of results.judges) {
    if (judges.some((row) => row.userId === judge.userId)) continue;
    judges.push({ userId: judge.userId, name: judge.name, email: null, kind: "judge", visible: judge.visible, reviewsSubmitted: judge.reviewsSubmitted, assigned: assignedCount.get(judge.userId) ?? 0 });
  }

  return {
    scope: { organisationSlug: ctx.organisation.slug, eventId: ctx.event.id },
    settings: settingsView(setup.settings),
    criteria: setup.criteria.map((criterion) => ({ ...criterion })),
    awards: setup.awards.map((award) => ({ ...award, winners: award.winners.map((winner) => ({ ...winner })) })),
    counts: setup.counts,
    submissions: submissions.map((row) => ({
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
    judges,
    results: results.rows.map((row) => ({
      submissionId: row.submissionId,
      title: row.title,
      entrantName: row.entrantName,
      status: row.status,
      score: row.score,
      judgesCounted: row.judgesCounted,
      rank: row.rank,
      criterionAverages: row.criterionAverages.map((average) => ({ ...average })),
    })),
    exportHref: `/api/exports/events/${ctx.event.id}/judging`,
    resultsUrl: `${ctx.origin}${resultsPath(ctx.organisation.slug, ctx.event.slug)}`,
  };
}
