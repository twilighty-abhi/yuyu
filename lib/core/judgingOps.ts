import "server-only";

import { EventPermission, JudgingStatus, Prisma, SubmissionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { isOrgAdmin } from "@/lib/permissions";
import { conflictKeysFor, judgeWorkOnSubmitted, listEligibleJudges, type ConflictKeys, type EligibleJudgeDto, type JudgingResult } from "@/lib/core/judging";
import { entrantDisplayName } from "@/lib/judgingDto";
import { judgeWeightedPercent } from "@/lib/judgingScore";
import { pairKey, planAutoAssignment, type AssignmentPair, type AutoAssignMode } from "@/lib/judgingAssignment";
import { numberedPage, type NumberedPage } from "@/lib/judgingOrganiserPaging";
import {
  autoAssignInputSchema,
  completionPercent,
  effectiveReviewTarget,
  findOutliers,
  isStaleReview,
  JUDGING_PROGRESS_PAGE_SIZE,
  judgingProgressQuerySchema,
  reviewsPerProjectSchema,
  type JudgingProgressSection,
} from "@/lib/judgingProgress";
import type { JudgingOrganiserContext } from "@/lib/judgingAccess";

/*
 * Judging operations for organisers (docs/HACKATHON.md): automatic judge
 * assignment, the per-project review target, and the Progress dashboard.
 * Organisation OWNER/ADMIN only: callers resolve `JudgingOrganiserContext`
 * (`resolveJudgingOrganiser`, the same check as every other judging
 * management surface), and every read here is re-scoped by event and
 * organisation. The assignment rules are pure functions in
 * lib/judgingAssignment.ts; the progress rules in lib/judgingProgress.ts.
 */

const EVENT_NOT_FOUND = "Event not found.";
const POOL_CHANGED = "Some of the people you picked can no longer judge this event. Refresh and try again.";
const PLAN_CHANGED = "Projects, judges or assignments changed since the preview. Preview again before applying.";
/** Shortfall rows returned with a preview (the total is always given). */
const PREVIEW_SHORTFALL_LIMIT = 50;

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function fail(error: string, fieldErrors?: Record<string, string[]>): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

const opsEventSelect = {
  id: true,
  organisationId: true,
  judgingStatus: true,
  judgesSeeAll: true,
  resultsPublishedAt: true,
  reviewsPerProject: true,
} satisfies Prisma.EventSelect;

type OpsEvent = Prisma.EventGetPayload<{ select: typeof opsEventSelect }>;

async function lockOpsEvent(tx: Prisma.TransactionClient, ctx: JudgingOrganiserContext): Promise<OpsEvent | null> {
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${ctx.eventId} AND "organisationId" = ${ctx.organisationId} FOR UPDATE`;
  return tx.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: opsEventSelect });
}

/** Conflicted (judge, project) pairs, found from each judge's own registrations: O(projects + conflict keys). */
function conflictedPairs(projects: ReadonlyArray<{ id: string; teamId: string | null; rsvpId: string | null }>, conflicts: ReadonlyMap<string, ConflictKeys>): Set<string> {
  const byTeam = new Map<string, string>();
  const byRsvp = new Map<string, string>();
  for (const project of projects) {
    if (project.teamId) byTeam.set(project.teamId, project.id);
    if (project.rsvpId) byRsvp.set(project.rsvpId, project.id);
  }
  const blocked = new Set<string>();
  for (const [judgeUserId, keys] of conflicts) {
    for (const teamId of keys.teamIds) {
      const projectId = byTeam.get(teamId);
      if (projectId) blocked.add(pairKey(judgeUserId, projectId));
    }
    for (const rsvpId of keys.rsvpIds) {
      const projectId = byRsvp.get(rsvpId);
      if (projectId) blocked.add(pairKey(judgeUserId, projectId));
    }
  }
  return blocked;
}

/** Org owners/admins and this event's JUDGE collaborators, read on `client` (inside the caller's transaction when given one). */
async function eligibleJudgeIds(client: Prisma.TransactionClient, organisationId: string, eventId: string): Promise<{ all: Set<string>; admins: Set<string> }> {
  const [admins, grants] = await Promise.all([
    client.membership.findMany({ where: { organisationId, role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true, role: true } }),
    client.eventCollaborator.findMany({ where: { eventId, event: { organisationId }, permissions: { has: EventPermission.JUDGE } }, select: { userId: true } }),
  ]);
  const adminIds = new Set(admins.filter((row) => isOrgAdmin(row.role)).map((row) => row.userId));
  return { all: new Set([...adminIds, ...grants.map((row) => row.userId)]), admins: adminIds };
}

// ---------------------------------------------------------------------------
// Review target
// ---------------------------------------------------------------------------

/**
 * Set (or clear, with null or "") the target number of judges per project
 * used by the Progress dashboard and as the automatic assignment default.
 * Audited (JUDGING_REVIEW_TARGET_UPDATED).
 */
export async function setReviewsPerProject(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult<{ reviewsPerProject: number | null }>> {
  let value: number | null = null;
  if (input !== null && input !== "" && input !== undefined) {
    const parsed = reviewsPerProjectSchema.safeParse(input);
    if (!parsed.success) return fail("Choose between 1 and 20 judges per project.", { reviewsPerProject: ["Choose between 1 and 20 judges per project."] });
    value = parsed.data;
  }
  return prisma.$transaction(async (tx): Promise<JudgingResult<{ reviewsPerProject: number | null }>> => {
    const event = await lockOpsEvent(tx, ctx);
    if (!event) return fail(EVENT_NOT_FOUND);
    if (event.reviewsPerProject === value) return ok({ reviewsPerProject: value });
    await tx.event.update({ where: { id: event.id }, data: { reviewsPerProject: value } });
    await recordAuditEvent({
      client: tx,
      action: "JUDGING_REVIEW_TARGET_UPDATED",
      actorUserId: ctx.userId,
      organisationId: ctx.organisationId,
      targetType: "Event",
      targetId: event.id,
      metadata: { from: event.reviewsPerProject, to: value },
    });
    return ok({ reviewsPerProject: value });
  });
}

// ---------------------------------------------------------------------------
// Automatic assignment
// ---------------------------------------------------------------------------

export type AutoAssignJudgeRow = {
  userId: string;
  name: string;
  kind: "admin" | "judge";
  before: number;
  added: number;
  removed: number;
  after: number;
};

export type AutoAssignShortfallRow = { submissionId: string; title: string; entrantName: string; assigned: number; missing: number; possible: number };

export type AutoAssignPreviewDto = {
  perProject: number;
  mode: AutoAssignMode;
  /** SUBMITTED projects considered. */
  projects: number;
  /** Projects that reach the target after the plan. */
  covered: number;
  added: number;
  removed: number;
  /** Projects judges already started without an assignment that become their assignments, so they keep access. */
  adopted: number;
  judges: AutoAssignJudgeRow[];
  /** The first PREVIEW_SHORTFALL_LIMIT projects that can't reach the target, most short first. */
  shortfalls: AutoAssignShortfallRow[];
  shortfallTotal: number;
  /** Whether judges currently see every project (applying switches this off). */
  judgesSeeAll: boolean;
  /** Pass back to apply: refused when the plan changed in between. */
  fingerprint: string;
};

export type AutoAssignAppliedDto = { added: number; removed: number; adopted: number; covered: number; shortfallTotal: number; projects: number };

type ParsedAutoAssign = { perProject: number; mode: AutoAssignMode; judgeUserIds: string[]; fingerprint?: string };

function autoAssignRefusal(event: OpsEvent): string | null {
  if (event.resultsPublishedAt) return "Results are published, so assignments can't change. Unpublish the results first.";
  if (event.judgingStatus === JudgingStatus.CLOSED) return "Judging is closed. Reopen it before assigning judges.";
  return null;
}

/** Read the event's assignment state and build the plan, on `client` (the apply transaction, or the plain client for a preview). */
async function buildAutoAssignPlan(client: Prisma.TransactionClient, ctx: JudgingOrganiserContext, event: OpsEvent, input: ParsedAutoAssign) {
  const pool = [...new Set(input.judgeUserIds)];
  const eligible = await eligibleJudgeIds(client, ctx.organisationId, event.id);
  if (pool.some((id) => !eligible.all.has(id))) return { ok: false, error: POOL_CHANGED } as const;

  const submittedOnly = { eventId: event.id, status: SubmissionStatus.SUBMITTED };
  const [projects, existing, worked] = await Promise.all([
    client.submission.findMany({ where: submittedOnly, select: { id: true, teamId: true, rsvpId: true }, orderBy: { id: "asc" } }),
    client.judgeAssignment.findMany({ where: { eventId: event.id, submission: submittedOnly }, select: { id: true, judgeUserId: true, submissionId: true } }),
    // Pairs with saved scores or a review row (draft or submitted).
    judgeWorkOnSubmitted(client, event.id, { withScores: false }),
  ]);
  // Conflicts for everyone whose pairs the plan looks at: the pool, assigned judges, and judges with work on a project.
  const judgeIds = [...new Set([...pool, ...existing.map((row) => row.judgeUserId), ...worked.map((row) => row.judgeUserId)])];
  const conflicts = await conflictKeysFor(client, event.id, judgeIds);
  const blocked = conflictedPairs(projects, conflicts);
  const started = new Set(worked.map((row) => pairKey(row.judgeUserId, row.submissionId)));
  const submitted = new Set(worked.filter((row) => row.submittedAt).map((row) => pairKey(row.judgeUserId, row.submissionId)));
  const plan = planAutoAssignment({
    projectIds: projects.map((row) => row.id),
    poolJudgeIds: pool,
    perProject: input.perProject,
    mode: input.mode,
    existing: existing.map((row) => ({ judgeUserId: row.judgeUserId, submissionId: row.submissionId })),
    blocked,
    started,
    submitted,
    // Applying switches judges to "assigned projects only", so work they started while seeing every project becomes theirs.
    adoptStarted: event.judgesSeeAll,
    canJudge: (judgeUserId) => eligible.all.has(judgeUserId),
  });
  const assignmentIds = new Map(existing.map((row) => [pairKey(row.judgeUserId, row.submissionId), row.id]));
  return { ok: true, plan, projects: projects.length, admins: eligible.admins, assignmentIds } as const;
}

function parseAutoAssign(input: unknown): { ok: true; data: ParsedAutoAssign } | { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  const parsed = autoAssignInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    const message = key === "perProject" ? "Choose between 1 and 20 judges per project." : key === "judgeUserIds" ? "Pick at least one judge." : "Invalid input.";
    fieldErrors[key] = [message];
  }
  return fail(Object.values(fieldErrors)[0]?.[0] ?? "Invalid input.", fieldErrors);
}

/**
 * Preview an automatic assignment without writing anything: per-judge loads
 * before and after, and the projects that can't reach the target.
 */
export async function previewAutoAssignment(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult<AutoAssignPreviewDto>> {
  const parsed = parseAutoAssign(input);
  if (!parsed.ok) return parsed;
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: opsEventSelect });
  if (!event) return fail(EVENT_NOT_FOUND);
  const refusal = autoAssignRefusal(event);
  if (refusal) return fail(refusal);
  const built = await buildAutoAssignPlan(prisma, ctx, event, parsed.data);
  if (!built.ok) return fail(built.error);
  const { plan } = built;

  const [judges, shortfallRows] = await Promise.all([
    listEligibleJudges(ctx),
    plan.shortfalls.length === 0
      ? Promise.resolve([])
      : prisma.submission.findMany({
          where: { eventId: event.id, id: { in: plan.shortfalls.slice(0, PREVIEW_SHORTFALL_LIMIT).map((row) => row.submissionId) } },
          select: { id: true, title: true, team: { select: { name: true } }, rsvp: { select: { guestName: true, user: { select: { name: true } } } } },
        }),
  ]);
  const judgeById = new Map(judges.map((judge) => [judge.userId, judge]));
  const projectById = new Map(shortfallRows.map((row) => [row.id, row]));
  const judgeRows: AutoAssignJudgeRow[] = plan.loads
    .map((load): AutoAssignJudgeRow => {
      const judge = judgeById.get(load.judgeUserId);
      return {
        userId: load.judgeUserId,
        name: judge?.name ?? "Judge",
        kind: judge?.kind ?? (built.admins.has(load.judgeUserId) ? "admin" : "judge"),
        before: load.before,
        added: load.added,
        removed: load.removed,
        after: load.after,
      };
    })
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) || (a.userId < b.userId ? -1 : 1) : a.kind === "judge" ? -1 : 1));
  return ok({
    perProject: parsed.data.perProject,
    mode: parsed.data.mode,
    projects: built.projects,
    covered: plan.covered,
    added: plan.add.length,
    removed: plan.remove.length,
    adopted: plan.adopt.length,
    judges: judgeRows,
    shortfalls: plan.shortfalls.slice(0, PREVIEW_SHORTFALL_LIMIT).map((row) => {
      const project = projectById.get(row.submissionId);
      return { ...row, title: project?.title ?? "Project", entrantName: project ? entrantDisplayName(project) : "" };
    }),
    shortfallTotal: plan.shortfalls.length,
    judgesSeeAll: event.judgesSeeAll,
    fingerprint: plan.fingerprint,
  });
}

/**
 * Apply an automatic assignment: re-plan under the Event row lock, refuse if
 * the plan differs from the preview the organiser saw, then remove (replace
 * mode) and add assignments (including projects judges already started
 * while they could see every project), switch judges to "assigned projects only", and
 * store the target. One transaction; audited (JUDGES_AUTO_ASSIGNED).
 */
export async function applyAutoAssignment(ctx: JudgingOrganiserContext, input: unknown): Promise<JudgingResult<AutoAssignAppliedDto>> {
  const parsed = parseAutoAssign(input);
  if (!parsed.ok) return parsed;
  if (!parsed.data.fingerprint) return fail(PLAN_CHANGED);
  return prisma.$transaction(
    async (tx): Promise<JudgingResult<AutoAssignAppliedDto>> => {
      const event = await lockOpsEvent(tx, ctx);
      if (!event) return fail(EVENT_NOT_FOUND);
      const refusal = autoAssignRefusal(event);
      if (refusal) return fail(refusal);
      const built = await buildAutoAssignPlan(tx, ctx, event, parsed.data);
      if (!built.ok) return fail(built.error);
      const { plan } = built;
      if (plan.fingerprint !== parsed.data.fingerprint) return fail(PLAN_CHANGED);

      const removeIds = plan.remove.map((pair: AssignmentPair) => built.assignmentIds.get(pairKey(pair.judgeUserId, pair.submissionId))).filter((id): id is string => Boolean(id));
      if (removeIds.length) await tx.judgeAssignment.deleteMany({ where: { eventId: event.id, id: { in: removeIds } } });
      const create = [...plan.add, ...plan.adopt];
      if (create.length) {
        await tx.judgeAssignment.createMany({
          data: create.map((pair) => ({ eventId: event.id, judgeUserId: pair.judgeUserId, submissionId: pair.submissionId })),
          skipDuplicates: true,
        });
      }
      await tx.event.update({ where: { id: event.id }, data: { judgesSeeAll: false, reviewsPerProject: parsed.data.perProject } });
      await recordAuditEvent({
        client: tx,
        action: "JUDGES_AUTO_ASSIGNED",
        actorUserId: ctx.userId,
        organisationId: ctx.organisationId,
        targetType: "Event",
        targetId: event.id,
        metadata: {
          perProject: parsed.data.perProject,
          mode: parsed.data.mode,
          judges: plan.loads.length,
          projects: built.projects,
          added: plan.add.length,
          removed: removeIds.length,
          adopted: plan.adopt.length,
          shortfalls: plan.shortfalls.length,
        },
      });
      return ok({ added: plan.add.length, removed: removeIds.length, adopted: plan.adopt.length, covered: plan.covered, shortfallTotal: plan.shortfalls.length, projects: built.projects });
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Progress dashboard
// ---------------------------------------------------------------------------

export type ProgressBelowTargetRow = {
  submissionId: string;
  title: string;
  entrantName: string;
  /** Counted (submitted) reviews. */
  reviews: number;
  /** Judges with saved scores but no submitted review. */
  inProgress: number;
  /** Assignments to judges who may judge it. */
  assigned: number;
  missing: number;
};

export type ProgressJudgeRow = {
  userId: string;
  name: string;
  email: string | null;
  kind: "admin" | "judge";
  /** Projects this judge is expected to review: their assignments, or every project they may see when judges see all. */
  assigned: number;
  /** Started (scores saved) but not submitted. */
  started: number;
  /** Counted reviews. */
  submitted: number;
  /** Submitted reviews of expected projects over expected projects, 0..100. */
  completion: number;
};

export type ProgressOutlierRow = {
  submissionId: string;
  title: string;
  judgeUserId: string;
  judgeName: string;
  score: number;
  othersMean: number;
  difference: number;
  judges: number;
  rule: "sd" | "fallback";
};

export type ProgressStaleRow = {
  submissionId: string;
  title: string;
  judgeUserId: string;
  judgeName: string;
  scored: number;
  criteria: number;
  /** ISO time of the last saved score. */
  lastSavedAt: string;
};

export type JudgingProgressSummary = {
  target: number;
  /** True when the organiser hasn't set a target and the default applies. */
  targetIsDefault: boolean;
  reviewsPerProject: number | null;
  judgingStatus: JudgingStatus;
  judgesSeeAll: boolean;
  projects: number;
  projectsAtTarget: number;
  reviewsCounted: number;
  /** Reviews towards the target (each project capped at the target) over projects × target, 0..100. */
  coverage: number;
};

type ProgressModel = {
  summary: JudgingProgressSummary;
  belowTarget: ProgressBelowTargetRow[];
  judges: ProgressJudgeRow[];
  outliers: ProgressOutlierRow[];
  stale: ProgressStaleRow[];
};

export type ProgressSectionPage<T> = NumberedPage<T>;

export type JudgingProgressDto = {
  summary: JudgingProgressSummary;
  belowTarget: ProgressSectionPage<ProgressBelowTargetRow>;
  judges: ProgressSectionPage<ProgressJudgeRow>;
  outliers: ProgressSectionPage<ProgressOutlierRow>;
  stale: ProgressSectionPage<ProgressStaleRow>;
};

export type JudgingProgressSectionDto =
  | { section: "below-target"; page: ProgressSectionPage<ProgressBelowTargetRow> }
  | { section: "judges"; page: ProgressSectionPage<ProgressJudgeRow> }
  | { section: "outliers"; page: ProgressSectionPage<ProgressOutlierRow> }
  | { section: "stale"; page: ProgressSectionPage<ProgressStaleRow> };

/**
 * Compute the whole Progress model for the event (bounded by the event's own
 * projects, judges and reviews, as the results table is). Counted reviews,
 * conflicts of interest and eligibility follow `loadJudgingResults`.
 */
async function buildProgressModel(ctx: JudgingOrganiserContext, now: Date): Promise<ProgressModel | null> {
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: opsEventSelect });
  if (!event) return null;
  const submittedOnly = { eventId: event.id, status: SubmissionStatus.SUBMITTED };
  const [projects, criteria, eligible, pairs, assignments] = await Promise.all([
    prisma.submission.findMany({
      where: submittedOnly,
      select: { id: true, title: true, teamId: true, rsvpId: true, team: { select: { name: true } }, rsvp: { select: { guestName: true, user: { select: { name: true } } } } },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    }),
    prisma.judgingCriterion.findMany({ where: { eventId: event.id }, select: { id: true, weight: true, maxScore: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    listEligibleJudges(ctx),
    // One row per (judge, project) with work, scores aggregated in SQL.
    judgeWorkOnSubmitted(prisma, event.id, { withScores: true }),
    prisma.judgeAssignment.findMany({ where: { eventId: event.id, submission: submittedOnly }, select: { submissionId: true, judgeUserId: true } }),
  ]);
  const judgeById = new Map<string, EligibleJudgeDto>(eligible.map((judge) => [judge.userId, judge]));
  const conflicts: Map<string, ConflictKeys> = await conflictKeysFor(prisma, event.id, [...judgeById.keys()]);
  const conflicted = conflictedPairs(projects, conflicts);
  const projectById = new Map(projects.map((row) => [row.id, row]));
  // A pair counts only when the judge can still judge the event and has no conflict with that entrant.
  const valid = (judgeUserId: string, submissionId: string) =>
    projectById.has(submissionId) && judgeById.has(judgeUserId) && !conflicted.has(pairKey(judgeUserId, submissionId));

  const submittedPairs = new Set<string>();
  const scoresByPair = new Map<string, ReadonlyMap<string, number>>();
  for (const pair of pairs) {
    if (!pair.submittedAt || !valid(pair.judgeUserId, pair.submissionId)) continue;
    const key = pairKey(pair.judgeUserId, pair.submissionId);
    submittedPairs.add(key);
    scoresByPair.set(key, pair.scores);
  }

  // Saved scores without a submitted review: in progress (and stale once old).
  type Started = { judgeUserId: string; submissionId: string; scored: number; lastSavedAt: Date };
  const startedPairs = new Map<string, Started>();
  for (const pair of pairs) {
    const key = pairKey(pair.judgeUserId, pair.submissionId);
    if (pair.scored === 0 || !pair.lastSavedAt || submittedPairs.has(key) || !valid(pair.judgeUserId, pair.submissionId)) continue;
    startedPairs.set(key, { judgeUserId: pair.judgeUserId, submissionId: pair.submissionId, scored: pair.scored, lastSavedAt: pair.lastSavedAt });
  }

  const validAssignments = assignments.filter((row) => valid(row.judgeUserId, row.submissionId));
  const target = effectiveReviewTarget(event.reviewsPerProject);

  // Per project.
  const reviewsByProject = new Map<string, string[]>();
  for (const key of submittedPairs) {
    const [judgeUserId, submissionId] = key.split("\u0000") as [string, string];
    const judges = reviewsByProject.get(submissionId);
    if (judges) judges.push(judgeUserId);
    else reviewsByProject.set(submissionId, [judgeUserId]);
  }
  const startedByProject = new Map<string, number>();
  for (const entry of startedPairs.values()) startedByProject.set(entry.submissionId, (startedByProject.get(entry.submissionId) ?? 0) + 1);
  const assignedByProject = new Map<string, number>();
  for (const row of validAssignments) assignedByProject.set(row.submissionId, (assignedByProject.get(row.submissionId) ?? 0) + 1);

  let towardsTarget = 0;
  const belowTarget: ProgressBelowTargetRow[] = [];
  const outliers: ProgressOutlierRow[] = [];
  for (const project of projects) {
    const judges = reviewsByProject.get(project.id) ?? [];
    towardsTarget += Math.min(judges.length, target);
    if (judges.length < target) {
      belowTarget.push({
        submissionId: project.id,
        title: project.title,
        entrantName: entrantDisplayName(project),
        reviews: judges.length,
        inProgress: startedByProject.get(project.id) ?? 0,
        assigned: assignedByProject.get(project.id) ?? 0,
        missing: target - judges.length,
      });
    }
    const percents = judges
      .map((judgeUserId) => ({ judgeUserId, percent: judgeWeightedPercent(criteria, (criterionId) => scoresByPair.get(pairKey(judgeUserId, project.id))?.get(criterionId)) }))
      .filter((entry): entry is { judgeUserId: string; percent: number } => entry.percent != null)
      .sort((a, b) => (a.judgeUserId < b.judgeUserId ? -1 : 1));
    for (const flag of findOutliers(percents)) {
      outliers.push({
        submissionId: project.id,
        title: project.title,
        judgeUserId: flag.judgeUserId,
        judgeName: judgeById.get(flag.judgeUserId)?.name ?? "Judge",
        score: flag.score,
        othersMean: flag.othersMean,
        difference: flag.difference,
        judges: percents.length,
        rule: flag.rule,
      });
    }
  }
  belowTarget.sort((a, b) => a.reviews - b.reviews || a.assigned - b.assigned || a.title.localeCompare(b.title) || (a.submissionId < b.submissionId ? -1 : 1));
  outliers.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.title.localeCompare(b.title) || (a.judgeUserId < b.judgeUserId ? -1 : 1));

  // Per judge: invited judges always; organisers once they have assignments, scores or reviews.
  const assignedByJudge = new Map<string, Set<string>>();
  for (const row of validAssignments) assignedByJudge.set(row.judgeUserId, (assignedByJudge.get(row.judgeUserId) ?? new Set()).add(row.submissionId));
  const startedByJudge = new Map<string, number>();
  for (const entry of startedPairs.values()) startedByJudge.set(entry.judgeUserId, (startedByJudge.get(entry.judgeUserId) ?? 0) + 1);
  const submittedByJudge = new Map<string, Set<string>>();
  for (const key of submittedPairs) {
    const [judgeUserId, submissionId] = key.split("\u0000") as [string, string];
    submittedByJudge.set(judgeUserId, (submittedByJudge.get(judgeUserId) ?? new Set()).add(submissionId));
  }
  // Projects each judge may not see (conflicts of interest), from the conflicted pairs.
  const conflictedByJudge = new Map<string, number>();
  for (const key of conflicted) {
    const judgeUserId = key.split("\u0000")[0]!;
    conflictedByJudge.set(judgeUserId, (conflictedByJudge.get(judgeUserId) ?? 0) + 1);
  }
  const judgeRows: ProgressJudgeRow[] = [];
  for (const judge of eligible) {
    const assignedSet = assignedByJudge.get(judge.userId) ?? new Set<string>();
    const submittedSet = submittedByJudge.get(judge.userId) ?? new Set<string>();
    const started = startedByJudge.get(judge.userId) ?? 0;
    if (judge.kind === "admin" && assignedSet.size === 0 && submittedSet.size === 0 && started === 0) continue;
    const expected = event.judgesSeeAll ? projects.length - (conflictedByJudge.get(judge.userId) ?? 0) : assignedSet.size;
    const done = event.judgesSeeAll ? submittedSet.size : [...submittedSet].filter((id) => assignedSet.has(id)).length;
    judgeRows.push({
      userId: judge.userId,
      name: judge.name,
      email: judge.email,
      kind: judge.kind,
      assigned: expected,
      started,
      submitted: submittedSet.size,
      completion: completionPercent(done, expected),
    });
  }
  judgeRows.sort((a, b) => a.completion - b.completion || a.name.localeCompare(b.name) || (a.userId < b.userId ? -1 : 1));

  const stale: ProgressStaleRow[] = [...startedPairs.values()]
    .filter((entry) => isStaleReview(entry.lastSavedAt, now))
    .sort((a, b) => a.lastSavedAt.getTime() - b.lastSavedAt.getTime() || (a.submissionId < b.submissionId ? -1 : 1) || (a.judgeUserId < b.judgeUserId ? -1 : 1))
    .map((entry) => ({
      submissionId: entry.submissionId,
      title: projectById.get(entry.submissionId)?.title ?? "Project",
      judgeUserId: entry.judgeUserId,
      judgeName: judgeById.get(entry.judgeUserId)?.name ?? "Judge",
      scored: entry.scored,
      criteria: criteria.length,
      lastSavedAt: entry.lastSavedAt.toISOString(),
    }));

  return {
    summary: {
      target,
      targetIsDefault: event.reviewsPerProject == null,
      reviewsPerProject: event.reviewsPerProject,
      judgingStatus: event.judgingStatus,
      judgesSeeAll: event.judgesSeeAll,
      projects: projects.length,
      projectsAtTarget: projects.length - belowTarget.length,
      reviewsCounted: submittedPairs.size,
      coverage: completionPercent(towardsTarget, projects.length * target),
    },
    belowTarget,
    judges: judgeRows,
    outliers,
    stale,
  };
}

/** The Progress tab: the summary and the first page of every list. Null when the event is gone. */
export async function loadJudgingProgress(ctx: JudgingOrganiserContext, now: Date = new Date()): Promise<JudgingProgressDto | null> {
  const model = await buildProgressModel(ctx, now);
  if (!model) return null;
  return {
    summary: model.summary,
    belowTarget: numberedPage(model.belowTarget, 1, JUDGING_PROGRESS_PAGE_SIZE),
    judges: numberedPage(model.judges, 1, JUDGING_PROGRESS_PAGE_SIZE),
    outliers: numberedPage(model.outliers, 1, JUDGING_PROGRESS_PAGE_SIZE),
    stale: numberedPage(model.stale, 1, JUDGING_PROGRESS_PAGE_SIZE),
  };
}

/** One numbered page of one Progress list (a page past the end shows the last page). */
export async function loadJudgingProgressPage(ctx: JudgingOrganiserContext, input: unknown, now: Date = new Date()): Promise<JudgingProgressSectionDto | null> {
  const parsed = judgingProgressQuerySchema.safeParse(input);
  if (!parsed.success) return null;
  const model = await buildProgressModel(ctx, now);
  if (!model) return null;
  const { section, page } = parsed.data as { section: JudgingProgressSection; page: number };
  switch (section) {
    case "below-target":
      return { section, page: numberedPage(model.belowTarget, page, JUDGING_PROGRESS_PAGE_SIZE) };
    case "judges":
      return { section, page: numberedPage(model.judges, page, JUDGING_PROGRESS_PAGE_SIZE) };
    case "outliers":
      return { section, page: numberedPage(model.outliers, page, JUDGING_PROGRESS_PAGE_SIZE) };
    case "stale":
      return { section, page: numberedPage(model.stale, page, JUDGING_PROGRESS_PAGE_SIZE) };
  }
}
