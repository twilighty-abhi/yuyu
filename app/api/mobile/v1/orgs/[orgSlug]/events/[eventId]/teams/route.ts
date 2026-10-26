import { isActionRateLimited } from "@/lib/actionRateLimit";
import { decodeTeamCursor } from "@/lib/core/teams";
import { eventRoute } from "@/lib/mobile/eventRoute";
import { mobileError, mobileOk, parseQuery } from "@/lib/mobile/http";
import { listTeamsForMobile, resolveTeamOrganiser, teamListQuerySchema } from "@/lib/mobile/teams";

/**
 * Guests → Teams on the phone: the same permission (canManageRegistrationsFor),
 * query, paging (oldest first, keyset cursor) and search-bucket limit as the
 * web Teams view. A CHECK_IN-only or JUDGE-only collaborator cannot list teams.
 */
export const GET = eventRoute("GET /api/mobile/v1/orgs/:orgSlug/events/:eventId/teams", null, async (request, _params, { auth, event }) => {
  const query = parseQuery(request, teamListQuerySchema);
  if ("response" in query) return query.response;
  const organiser = await resolveTeamOrganiser(auth.userId, event);
  if (!organiser) return mobileError("FORBIDDEN");
  if (query.data.cursor && !decodeTeamCursor(query.data.cursor)) return mobileError("INVALID_REQUEST", "Invalid cursor.");
  if (await isActionRateLimited("search", auth.userId)) return mobileError("RATE_LIMITED");
  return mobileOk(await listTeamsForMobile(organiser, query.data));
});
