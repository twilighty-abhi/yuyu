import { judgeDetailResponse, judgingRoute } from "@/lib/mobile/judging";

type Params = { orgSlug: string; eventId: string; submissionId: string };

/** One project for scoring, with this judge's own saved scores and private comment only. */
export const GET = judgingRoute<Params>("GET /api/mobile/v1/orgs/:orgSlug/events/:eventId/judging/submissions/:submissionId", "action", async (_request, { submissionId }, { judge }) => {
  return judgeDetailResponse(judge, submissionId);
});
