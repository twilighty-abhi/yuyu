import "server-only";

import { z } from "zod";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { prisma } from "@/lib/db";
import { listJudgeSubmissionsPage, listSubmissionsForJudge, loadSubmissionForJudge } from "@/lib/core/judging";
import { resolveJudgeContext, type JudgeContext } from "@/lib/judgingAccess";
import type { JudgeSubmissionDetailDto } from "@/lib/judgingDto";
import { decodeSubmissionCursor, JUDGE_SUBMISSION_FILTERS, JUDGING_SEARCH_MAX_LENGTH } from "@/lib/judgingPaging";
import { toJudgeSubmission } from "@/lib/mobile/dto";
import { mobileError, mobileOk } from "@/lib/mobile/http";
import { resolveEventContext } from "@/lib/mobile/organiser";
import { authedMobileRoute, type AuthedRouteContext } from "@/lib/mobile/route";
import { judgeSubmissionDetailDtoSchema, judgeSubmissionListDtoSchema, judgingCriteriaDtoSchema } from "@/lib/mobile/schemas";

/*
 * Judge workspace for the mobile apps (docs/MOBILE_API.md, docs/HACKATHON.md).
 * Who may judge is decided only by `resolveJudgeContext` (OWNER/ADMIN or the
 * event's JUDGE grant), exactly as the web judge actions; visibility
 * (SUBMITTED, assignment, conflict of interest), the judging status and the
 * rubric are re-checked by the cores in lib/core/judging.ts. Judges see
 * project content and display names only: never entrant emails, answers,
 * ticket links, disqualification reasons, or other judges' scores.
 */

type JudgingParams = { orgSlug: string; eventId: string };

/**
 * A judging route. An event outside what the caller can see (including
 * another organisation's) is NOT_FOUND; an event the caller sees as an
 * organiser without the judging right is FORBIDDEN. Each call is rate limited
 * like the web judge actions (`search` bucket for list reads, `action` for the
 * rest) on top of the per-user mobile limit.
 */
export function judgingRoute<P extends JudgingParams = JudgingParams>(
  routeId: string,
  bucket: "action" | "search",
  handler: (request: Request, params: P, context: AuthedRouteContext & { judge: JudgeContext }) => Promise<Response>,
) {
  return authedMobileRoute<P>(routeId, async (request, params, context) => {
    if (await isActionRateLimited(bucket, context.auth.userId)) return mobileError("RATE_LIMITED");
    const judge = await resolveJudgeContext(context.auth.userId, params.orgSlug, params.eventId);
    if (!judge) {
      const visible = await resolveEventContext(context.auth.userId, params.orgSlug, params.eventId);
      return mobileError(visible ? "FORBIDDEN" : "NOT_FOUND");
    }
    return handler(request, params, { ...context, judge });
  });
}

export const judgeListQuerySchema = z.object({
  filter: z.enum(["all", "todo", "inProgress", "reviewed"]).default("all"),
  q: z.string().trim().max(JUDGING_SEARCH_MAX_LENGTH).optional(),
  cursor: z.string().trim().min(1).max(160).optional(),
}).strict();

export type JudgeListQuery = z.infer<typeof judgeListQuerySchema>;

const FILTER_TO_CORE: Record<JudgeListQuery["filter"], (typeof JUDGE_SUBMISSION_FILTERS)[number]> = {
  all: "all",
  todo: "todo",
  inProgress: "in_progress",
  reviewed: "reviewed",
};

export function isValidSubmissionCursor(cursor: string | undefined) {
  return cursor === undefined || decodeSubmissionCursor(cursor) !== null;
}

/** Which of these submissions this judge has a review row for (a saved comment counts as a draft). */
async function reviewRowIds(judgeUserId: string, submissionIds: string[]) {
  if (submissionIds.length === 0) return new Set<string>();
  const rows = await prisma.judgeReview.findMany({ where: { judgeUserId, submissionId: { in: submissionIds } }, select: { submissionId: true } });
  return new Set(rows.map((row) => row.submissionId));
}

/** One page of the judge's list with totals; null when the event is not a judging event for this judge. */
export async function listJudgeSubmissionsForMobile(ctx: JudgeContext, query: JudgeListQuery) {
  const input = { query: query.q ?? "", filter: FILTER_TO_CORE[query.filter], cursor: query.cursor ?? null };
  const [page, event] = await Promise.all([
    // Re-checks eligibility and submissionsEnabled; null otherwise.
    listJudgeSubmissionsPage(ctx, input),
    prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: { judgingStatus: true } }),
  ]);
  if (!page || !event) return null;
  const drafts = await reviewRowIds(ctx.userId, page.submissions.map((row) => row.id));
  return judgeSubmissionListDtoSchema.parse({
    judgingStatus: event.judgingStatus,
    submissions: page.submissions.map((row) => toJudgeSubmission(row, drafts.has(row.id))),
    nextCursor: page.nextCursor,
    counts: { all: page.counts.all, todo: page.counts.todo, inProgress: page.counts.in_progress, reviewed: page.counts.reviewed },
  });
}

export function toJudgeDetail(detail: JudgeSubmissionDetailDto) {
  return judgeSubmissionDetailDtoSchema.parse({
    judgingStatus: detail.judgingStatus,
    criteria: detail.criteria.map((criterion) => ({
      id: criterion.id,
      name: criterion.name,
      description: criterion.description,
      weight: criterion.weight,
      maxScore: criterion.maxScore,
    })),
    submission: toJudgeSubmission(detail.submission, detail.myReview != null),
    myScores: detail.myScores.map((score) => ({ criterionId: score.criterionId, score: score.score })),
    myComment: detail.myReview?.comment ?? null,
    mySubmittedAt: detail.myReview?.submittedAt?.toISOString() ?? null,
  });
}

/**
 * One submission for scoring with this judge's own scores and comment, or the
 * refusal code. An event that is not taking submissions is NOT_FOUND, as on
 * every other judging route (the list, next, criteria, and the scores/review
 * cores' EVENT_NOT_FOUND); NOT_VISIBLE is kept for a project this judge may not
 * score (not SUBMITTED, unassigned, conflict of interest, or another event's).
 */
export async function loadJudgeDetailForMobile(ctx: JudgeContext, submissionId: string): Promise<
  { ok: true; detail: ReturnType<typeof toJudgeDetail> } | { ok: false; code: "NOT_FOUND" | "NOT_VISIBLE" }
> {
  const detail = await loadSubmissionForJudge(ctx, submissionId);
  if (detail) return { ok: true, detail: toJudgeDetail(detail) };
  const event = await prisma.event.findFirst({ where: { id: ctx.eventId, organisationId: ctx.organisationId }, select: { submissionsEnabled: true } });
  return { ok: false, code: event?.submissionsEnabled ? "NOT_VISIBLE" : "NOT_FOUND" };
}

/** The detail response, or its refusal. */
export async function judgeDetailResponse(ctx: JudgeContext, submissionId: string) {
  const result = await loadJudgeDetailForMobile(ctx, submissionId);
  return result.ok ? mobileOk(result.detail) : mobileError(result.code);
}

/** The rubric and judging status; null when the event is not a judging event for this judge. */
export async function loadJudgingCriteriaForMobile(ctx: JudgeContext) {
  // The workspace read re-checks eligibility and submissionsEnabled; only its rubric and status are returned.
  const workspace = await listSubmissionsForJudge(ctx, { query: "", filter: "all", cursor: null });
  if (!workspace) return null;
  return judgingCriteriaDtoSchema.parse({
    judgingStatus: workspace.judgingStatus,
    criteria: workspace.criteria.map((criterion) => ({
      id: criterion.id,
      name: criterion.name,
      description: criterion.description,
      weight: criterion.weight,
      maxScore: criterion.maxScore,
    })),
  });
}
