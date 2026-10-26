import { mobileError, mobileOk, parseQuery } from "@/lib/mobile/http";
import { isValidSubmissionCursor, judgeListQuerySchema, judgingRoute, listJudgeSubmissionsForMobile } from "@/lib/mobile/judging";

/**
 * The judge's list (25 per page, oldest submission first, keyset cursor):
 * only projects this judge may score (SUBMITTED, assigned unless judges see
 * all, conflict of interest excluded), with their own review state.
 */
export const GET = judgingRoute("GET /api/mobile/v1/orgs/:orgSlug/events/:eventId/judging/submissions", "search", async (request, _params, { judge }) => {
  const query = parseQuery(request, judgeListQuerySchema);
  if ("response" in query) return query.response;
  if (!isValidSubmissionCursor(query.data.cursor)) return mobileError("INVALID_REQUEST", "Invalid cursor.");
  const page = await listJudgeSubmissionsForMobile(judge, query.data);
  return page ? mobileOk(page) : mobileError("NOT_FOUND");
});
