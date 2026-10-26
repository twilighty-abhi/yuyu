import { revalidatePath } from "next/cache";
import { z } from "zod";
import { saveJudgeScores, submitJudgeReview } from "@/lib/core/judging";
import { mobileActionError, mobileError, parseJsonBody, zodFieldErrors } from "@/lib/mobile/http";
import { judgeDetailResponse, judgingRoute } from "@/lib/mobile/judging";
import { judgeReviewSchema } from "@/lib/validators";
import { prisma } from "@/lib/db";

type Params = { orgSlug: string; eventId: string; submissionId: string };

const bodySchema = z.object({
  scores: z.array(z.object({ criterionId: z.string().min(1).max(128), score: z.number().int() }).strict()).max(100).optional(),
  comment: z.string().max(10_000).optional(),
}).strict();

/**
 * Submit this judge's review (as the web "Submit review"): optional scores are
 * saved first, then the review is marked complete once every criterion is
 * scored. Refusals: JUDGING_CLOSED, INCOMPLETE_SCORES, NOT_VISIBLE. Returns
 * the project as `GET …/judging/submissions/:id`.
 */
export const POST = judgingRoute<Params>("POST /api/mobile/v1/orgs/:orgSlug/events/:eventId/judging/submissions/:submissionId/review", "action", async (request, { submissionId }, { judge }) => {
  const body = await parseJsonBody(request, bodySchema);
  if ("response" in body) return body.response;
  const { scores, comment } = body.data;
  const review = judgeReviewSchema.safeParse({ submissionId, ...(comment !== undefined ? { comment } : {}), submit: true });
  if (!review.success) return mobileError("INVALID_REQUEST", "Check the highlighted fields.", { fieldErrors: zodFieldErrors(review.error) });
  if (scores && scores.length > 0) {
    const saved = await saveJudgeScores(judge, { submissionId, scores });
    if (!saved.ok) return mobileActionError(saved);
  }
  // Without a new comment, keep the saved draft comment.
  const existing = comment === undefined
    ? (await prisma.judgeReview.findUnique({ where: { submissionId_judgeUserId: { submissionId, judgeUserId: judge.userId } }, select: { comment: true } }))?.comment ?? ""
    : review.data.comment;
  const submitted = await submitJudgeReview(judge, { submissionId, comment: existing, submit: true });
  revalidatePath(`/dashboard/${judge.orgSlug}/event/${judge.eventId}`);
  if (!submitted.ok) return mobileActionError(submitted);
  return judgeDetailResponse(judge, submissionId);
});
