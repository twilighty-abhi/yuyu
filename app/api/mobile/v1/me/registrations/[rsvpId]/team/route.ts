import { loadMyRegistrationTeam } from "@/lib/mobile/account";
import { mobileOk, notFound } from "@/lib/mobile/http";
import { authedMobileRoute } from "@/lib/mobile/route";

type Params = { rsvpId: string };

/** The caller's own registration's team (names only), or `{ team: null }` for a solo registration. Anyone else's RSVP is NOT_FOUND. */
export const GET = authedMobileRoute<Params>("GET /api/mobile/v1/me/registrations/:rsvpId/team", async (_request, { rsvpId }, { auth }) => {
  const result = await loadMyRegistrationTeam(auth.userId, rsvpId);
  return result ? mobileOk(result) : notFound();
});
