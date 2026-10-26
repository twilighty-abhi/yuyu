"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import * as judging from "@/lib/core/judging";
import { resolveJudgingOrganiser, type JudgingOrganiserContext } from "@/lib/judgingAccess";
import { projectGalleryPath, resultsPath } from "@/lib/submissionToken";
import { countUnsubmittedEntrants, listUnsubmittedEntrants } from "@/lib/core/judgingEntrants";
import {
  toDashboardResultsPage,
  toDashboardSubmissionsPage,
  toDashboardUnsubmittedPage,
  type JudgingDashboardUnsubmittedPage,
  type JudgingDashboardAwardCandidate,
  type JudgingDashboardResultsPage,
  type JudgingDashboardSubmissionsPage,
} from "@/lib/eventDashboard/judging";
import type { ActionResult } from "./org";

/*
 * Organiser actions for the event dashboard's Judging tab (docs/HACKATHON.md).
 * The permission check is the one that guards the organiser RSVP actions
 * (organisation OWNER/ADMIN, via resolveJudgingOrganiser), so a JUDGE-only or
 * other event collaborator can never change settings, the rubric,
 * assignments, awards or results. The rules, the Event lock, and the audit
 * events (settings, judging status, disqualification, reinstatement, results)
 * live in lib/core/judging.ts; these actions never audit those again.
 */

const NO_PERMISSION = "You do not have permission to manage judging for this event.";

const scopeSchema = z.object({
  organisationSlug: z.string().trim().min(1).max(128),
  eventId: z.string().trim().min(1).max(128),
});

type Gate = { ok: true; ctx: JudgingOrganiserContext; input: Record<string, unknown> } | { ok: false; error: string };

function record(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

async function organiserGate(input: unknown, bucket: "action" | "broadcast" | "search" = "action"): Promise<Gate> {
  const fields = record(input);
  const scope = scopeSchema.safeParse({ organisationSlug: fields.organisationSlug, eventId: fields.eventId });
  if (!scope.success) return { ok: false, error: "Invalid input." };
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited(bucket, userId)) return { ok: false, error: bucket === "search" ? "Too many searches. Try again shortly." : "Too many judging updates. Try again shortly." };
  const ctx = await resolveJudgingOrganiser(userId, scope.data.organisationSlug, scope.data.eventId);
  if (!ctx) return { ok: false, error: NO_PERMISSION };
  return { ok: true, ctx, input: fields };
}

function revalidateJudging(ctx: JudgingOrganiserContext) {
  revalidatePath(`/dashboard/${ctx.orgSlug}/event/${ctx.eventId}`);
  revalidatePath(`/${ctx.orgSlug}/${ctx.eventSlug}`);
  revalidatePath(projectGalleryPath(ctx.orgSlug, ctx.eventSlug));
  revalidatePath(resultsPath(ctx.orgSlug, ctx.eventSlug));
}

/** Run a core with the gated context and revalidate on success. */
async function run<T>(input: unknown, call: (ctx: JudgingOrganiserContext, fields: Record<string, unknown>) => Promise<judging.JudgingResult<T>>, bucket?: "action" | "broadcast"): Promise<ActionResult<T>> {
  const gate = await organiserGate(input, bucket);
  if (!gate.ok) return gate;
  const result = await call(gate.ctx, gate.input);
  if (result.ok) revalidateJudging(gate.ctx);
  return result;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Settings and judging status
// ---------------------------------------------------------------------------

/** Submissions on/off, the window (ISO instants), judge visibility, and the public gallery. */
export async function saveJudgingSettings(input: unknown): Promise<ActionResult<{ judgingStatus: string }>> {
  return run(input, async (ctx, fields) => {
    const settings = record(fields.settings);
    const result = await judging.updateJudgingSettings(ctx, {
      submissionsEnabled: settings.submissionsEnabled,
      submissionsOpenAt: settings.submissionsOpenAt,
      submissionsCloseAt: settings.submissionsCloseAt,
      judgesSeeAll: settings.judgesSeeAll,
      projectGalleryPublic: settings.projectGalleryPublic,
    });
    return result.ok ? { ok: true, data: { judgingStatus: result.data.judgingStatus } } : result;
  });
}

export async function changeJudgingStatus(input: unknown): Promise<ActionResult<{ judgingStatus: string }>> {
  return run(input, (ctx, fields) => judging.setJudgingStatus(ctx, fields.status));
}

/** "Adjust for harsh/generous judges": RAW or ZSCORE ranks the Results table (audited in the core). */
export async function changeScoreNormalization(input: unknown): Promise<ActionResult<{ scoreNormalization: string }>> {
  return run(input, (ctx, fields) => judging.setScoreNormalization(ctx, fields.scoreNormalization));
}

// ---------------------------------------------------------------------------
// Rubric
// ---------------------------------------------------------------------------

function criterionInput(value: unknown) {
  const fields = record(value);
  return { name: fields.name, description: fields.description, weight: fields.weight, maxScore: fields.maxScore };
}

export async function addJudgingCriterion(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run(input, (ctx, fields) => judging.createJudgingCriterion(ctx, criterionInput(fields.criterion)));
}

export async function editJudgingCriterion(input: unknown): Promise<ActionResult> {
  return run(input, async (ctx, fields) => judging.updateJudgingCriterion(ctx, asString(fields.criterionId), criterionInput(fields.criterion)));
}

export async function removeJudgingCriterion(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.deleteJudgingCriterion(ctx, asString(fields.criterionId)));
}

export async function reorderJudgingCriteria(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.reorderJudgingCriteria(ctx, fields.ids));
}

// ---------------------------------------------------------------------------
// Awards and winners
// ---------------------------------------------------------------------------

function awardInput(value: unknown) {
  const fields = record(value);
  return { name: fields.name, description: fields.description };
}

export async function addEventAward(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run(input, (ctx, fields) => judging.createEventAward(ctx, awardInput(fields.award)));
}

export async function editEventAward(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.updateEventAward(ctx, asString(fields.awardId), awardInput(fields.award)));
}

export async function removeEventAward(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.deleteEventAward(ctx, asString(fields.awardId)));
}

export async function reorderEventAwards(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.reorderEventAwards(ctx, fields.ids));
}

export async function setEventAwardWinner(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.setAwardWinner(ctx, { awardId: fields.awardId, submissionId: fields.submissionId, place: fields.place }));
}

export async function removeEventAwardWinner(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.removeAwardWinner(ctx, { awardId: fields.awardId, place: fields.place }));
}

// ---------------------------------------------------------------------------
// Submissions: moderation and judge assignment
// ---------------------------------------------------------------------------

export async function disqualifyProject(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.disqualifySubmission(ctx, { submissionId: fields.submissionId, reason: fields.reason }));
}

export async function reinstateProject(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.reinstateSubmission(ctx, asString(fields.submissionId)));
}

export async function assignProjectJudge(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.assignJudge(ctx, { judgeUserId: fields.judgeUserId, submissionId: fields.submissionId }));
}

export async function unassignProjectJudge(input: unknown): Promise<ActionResult> {
  return run(input, (ctx, fields) => judging.unassignJudge(ctx, { judgeUserId: fields.judgeUserId, submissionId: fields.submissionId }));
}

export type SubmissionReviewView = {
  judgeName: string;
  submittedAt: string | null;
  comment: string;
  scores: Array<{ criterionId: string; score: number }>;
};

/** Judges' scores and private comments for one project (organisers only; read-only, no revalidation). */
export async function loadProjectReviews(input: unknown): Promise<ActionResult<SubmissionReviewView[]>> {
  const gate = await organiserGate(input);
  if (!gate.ok) return gate;
  const reviews = await judging.loadSubmissionReviewsForOrganiser(gate.ctx, asString(gate.input.submissionId));
  if (!reviews) return { ok: false, error: "Submission not found." };
  return {
    ok: true,
    data: reviews.map((review) => ({
      judgeName: review.judgeName,
      submittedAt: review.submittedAt ? review.submittedAt.toISOString() : null,
      comment: review.comment,
      scores: review.scores,
    })),
  };
}

// ---------------------------------------------------------------------------
// Paged reads (read-only, no revalidation, on the search rate-limit bucket)
// ---------------------------------------------------------------------------

/**
 * One page of Judging → Submissions for a status filter, a search, or "Load
 * more" (bounded by ORGANISER_SUBMISSIONS_PAGE_SIZE). The core re-validates
 * the query and re-reads the event inside the organisation.
 */
export async function loadSubmissionsPage(input: unknown): Promise<ActionResult<JudgingDashboardSubmissionsPage>> {
  const gate = await organiserGate(input, "search");
  if (!gate.ok) return gate;
  const { query, status, cursor } = gate.input;
  const page = await judging.listSubmissionsForOrganiser(gate.ctx, { query: query ?? "", status: status ?? "all", cursor: cursor ?? null });
  return { ok: true, data: toDashboardSubmissionsPage(page) };
}

/**
 * Judging → Submissions → Not submitted: confirmed teams and solo registrants
 * whose project isn't SUBMITTED, a "Load more" page at a time, with the
 * number matching the search on the first page. The same organiser gate.
 */
export async function loadUnsubmittedEntrantsPage(input: unknown): Promise<ActionResult<JudgingDashboardUnsubmittedPage & { total: number | null }>> {
  const gate = await organiserGate(input, "search");
  if (!gate.ok) return gate;
  const { query, cursor } = gate.input;
  const [page, total] = await Promise.all([
    listUnsubmittedEntrants(gate.ctx, { query: query ?? "", cursor: cursor ?? null }),
    cursor ? Promise.resolve(null) : countUnsubmittedEntrants(gate.ctx, typeof query === "string" ? query : ""),
  ]);
  return { ok: true, data: { ...toDashboardUnsubmittedPage(page), total } };
}

/** One numbered page of the ranked table, optionally searched; ranks always come from the whole ranking. */
export async function loadResultsPage(input: unknown): Promise<ActionResult<JudgingDashboardResultsPage>> {
  const gate = await organiserGate(input, "search");
  if (!gate.ok) return gate;
  const page = await judging.loadJudgingResultsPage(gate.ctx, { query: gate.input.query ?? "", page: gate.input.page ?? 1, scored: gate.input.scored ?? "all" });
  if (!page) return { ok: false, error: "Invalid input." };
  return { ok: true, data: toDashboardResultsPage(page) };
}

/** Projects the Awards winner picker offers: SUBMITTED, by rank, searchable, in steps of AWARD_CANDIDATES_PAGE_SIZE. */
export async function searchAwardCandidates(
  input: unknown,
): Promise<ActionResult<{ candidates: JudgingDashboardAwardCandidate[]; total: number; nextOffset: number | null }>> {
  const gate = await organiserGate(input, "search");
  if (!gate.ok) return gate;
  const page = await judging.searchAwardCandidates(gate.ctx, { query: gate.input.query ?? "", offset: gate.input.offset ?? 0 });
  if (!page) return { ok: false, error: "Invalid input." };
  return { ok: true, data: { candidates: page.rows.map((row) => ({ ...row })), total: page.total, nextOffset: page.nextOffset } };
}

// ---------------------------------------------------------------------------
// Results publication
// ---------------------------------------------------------------------------

/** Publish results and queue the announcement emails (the broadcast rate-limit bucket applies). */
export async function publishJudgingResults(input: unknown): Promise<ActionResult<{ queued: number; alreadyPublished: boolean }>> {
  return run(
    input,
    async (ctx) => {
      const result = await judging.publishResults(ctx);
      return result.ok ? { ok: true, data: { queued: result.data.queued, alreadyPublished: result.data.alreadyPublished } } : result;
    },
    "broadcast",
  );
}

export async function unpublishJudgingResults(input: unknown): Promise<ActionResult> {
  return run(input, (ctx) => judging.unpublishResults(ctx));
}
