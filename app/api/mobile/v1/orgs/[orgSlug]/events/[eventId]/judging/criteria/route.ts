import { mobileError, mobileOk } from "@/lib/mobile/http";
import { judgingRoute, loadJudgingCriteriaForMobile } from "@/lib/mobile/judging";

/** The rubric (name, description, weight, max score) and the judging status. */
export const GET = judgingRoute("GET /api/mobile/v1/orgs/:orgSlug/events/:eventId/judging/criteria", "action", async (_request, _params, { judge }) => {
  const criteria = await loadJudgingCriteriaForMobile(judge);
  return criteria ? mobileOk(criteria) : mobileError("NOT_FOUND");
});
