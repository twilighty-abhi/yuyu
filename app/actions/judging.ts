"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { resolveJudgeContext, type JudgeContext } from "@/lib/judgingAccess";
import { loadSubmissionForJudge, saveJudgeScores, submitJudgeReview } from "@/lib/core/judging";
import type { JudgeSubmissionDetailDto } from "@/lib/judgingDto";
import type { ActionResult } from "./org";

/*
 * Judging Server Actions (docs/HACKATHON.md).
 *
 * Judge workspace: org owners/admins and JUDGE collaborators score the
 * submissions they may see. Every call re-resolves the judge from the session
 * and the organisation slug (resolveJudgeContext), and the core re-checks the
 * grant, the judging status, visibility (assignment and conflict of interest)
 * and the rubric inside its transaction. Nothing here decides who may judge.
 */

const NO_ACCESS = "You do not have access to judging for this event.";

const judgeScope = z.object({
  organisationSlug: z.string().min(1).max(128),
  eventId: z.string().min(1).max(128),
});

type JudgeGate = { ok: true; ctx: JudgeContext; rest: Record<string, unknown> } | { ok: false; error: string };

async function judgeGate(input: unknown): Promise<JudgeGate> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "You must be signed in." };
  if (await isActionRateLimited("action", userId)) return { ok: false, error: "Too many judging updates. Try again shortly." };
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid request." };
  const { organisationSlug, eventId, ...rest } = input as Record<string, unknown>;
  const scope = judgeScope.safeParse({ organisationSlug, eventId });
  if (!scope.success) return { ok: false, error: "Invalid request." };
  const ctx = await resolveJudgeContext(userId, scope.data.organisationSlug, scope.data.eventId);
  if (!ctx) return { ok: false, error: NO_ACCESS };
  return { ok: true, ctx, rest };
}

function revalidateJudgeWorkspace(ctx: JudgeContext) {
  revalidatePath(`/dashboard/${ctx.orgSlug}/event/${ctx.eventId}`);
}

/** One submission for scoring, with only this judge's own scores and comment. */
export async function loadJudgeSubmission(input: unknown): Promise<ActionResult<JudgeSubmissionDetailDto>> {
  const gate = await judgeGate(input);
  if (!gate.ok) return gate;
  const submissionId = typeof gate.rest.submissionId === "string" ? gate.rest.submissionId : "";
  const detail = await loadSubmissionForJudge(gate.ctx, submissionId);
  if (!detail) return { ok: false, error: "This submission is not available to you." };
  return { ok: true, data: detail };
}

/** Save some or all of this judge's scores for one submission. */
export async function saveJudgeScoresAction(input: unknown): Promise<ActionResult<{ scored: number; total: number }>> {
  const gate = await judgeGate(input);
  if (!gate.ok) return gate;
  const result = await saveJudgeScores(gate.ctx, { submissionId: gate.rest.submissionId, scores: gate.rest.scores });
  if (result.ok) revalidateJudgeWorkspace(gate.ctx);
  return result;
}

/**
 * Save scores and the private comment together, and with `submit` mark the
 * review complete (every criterion must be scored). Scores are written first,
 * so a refused submit still keeps the scores the judge entered.
 */
export async function saveJudgeReviewAction(input: unknown): Promise<ActionResult<{ scored: number; total: number; submitted: boolean }>> {
  const gate = await judgeGate(input);
  if (!gate.ok) return gate;
  const { submissionId, scores, comment, submit } = gate.rest;
  const saved = await saveJudgeScores(gate.ctx, { submissionId, scores });
  if (!saved.ok) return saved;
  const review = await submitJudgeReview(gate.ctx, { submissionId, comment, submit: submit === true });
  revalidateJudgeWorkspace(gate.ctx);
  if (!review.ok) return review;
  return { ok: true, data: { ...saved.data, submitted: review.data.submitted } };
}
