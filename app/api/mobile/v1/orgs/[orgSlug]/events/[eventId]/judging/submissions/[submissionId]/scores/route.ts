import { revalidatePath } from "next/cache";
import { z } from "zod";
import { saveJudgeScores, submitJudgeReview } from "@/lib/core/judging";
import { myReviewStatus } from "@/lib/mobile/dto";
import { mobileActionError, mobileError, mobileOk, parseJsonBody, zodFieldErrors } from "@/lib/mobile/http";
import { judgingRoute } from "@/lib/mobile/judging";
import { judgeScoresSavedDtoSchema } from "@/lib/mobile/schemas";
import { judgeReviewSchema } from "@/lib/validators";
import { prisma } from "@/lib/db";

type Params = { orgSlug: string; eventId: string; submissionId: string };

const bodySchema = z.object({
  scores: z.array(z.object({ criterionId: z.string().min(1).max(128), score: z.number().int() }).strict()).max(100),
  comment: z.string().max(10_000).optional(),
}).strict();

/**
 * Save some or all of this judge's scores (and, optionally, the private
 * comment as a draft) without submitting. The core re-checks the judge,
 * judging status (JUDGING_CLOSED), visibility (NOT_VISIBLE) and each
 * criterion's range inside its transaction.
 */
export const PUT = judgingRoute<Params>("PUT /api/mobile/v1/orgs/:orgSlug/events/:eventId/judging/submissions/:submissionId/scores", "action", async (request, { submissionId }, { judge }) => {
  const body = await parseJsonBody(request, bodySchema);
  if ("response" in body) return body.response;
  const { scores, comment } = body.data;
  // Validate the comment first, as the web does, so an invalid comment never leaves scores half-saved.
  if (comment !== undefined) {
    const review = judgeReviewSchema.safeParse({ submissionId, comment, submit: false });
    if (!review.success) return mobileError("INVALID_REQUEST", "Check the highlighted fields.", { fieldErrors: zodFieldErrors(review.error) });
  }
  const saved = await saveJudgeScores(judge, { submissionId, scores });
  if (!saved.ok) return mobileActionError(saved);
  if (comment !== undefined) {
    const draft = await submitJudgeReview(judge, { submissionId, comment, submit: false });
    if (!draft.ok) return mobileActionError(draft);
  }
  revalidatePath(`/dashboard/${judge.orgSlug}/event/${judge.eventId}`);
  const review = await prisma.judgeReview.findUnique({ where: { submissionId_judgeUserId: { submissionId, judgeUserId: judge.userId } }, select: { submittedAt: true } });
  if (!saved.data) return mobileError("INTERNAL_ERROR");
  return mobileOk(judgeScoresSavedDtoSchema.parse({
    scored: saved.data.scored,
    total: saved.data.total,
    myReview: {
      status: myReviewStatus({ reviewSubmitted: Boolean(review?.submittedAt), scoredCriteria: saved.data.scored, hasReviewRow: review != null }),
      scoredCriteria: saved.data.scored,
    },
  }));
});
