import { reacceptRsvpForUser } from "@/lib/core/rsvpLifecycle";
import { eventRoute } from "@/lib/mobile/eventRoute";
import { mobileActionError, mobileOk, notFound } from "@/lib/mobile/http";
import { loadGuest } from "@/lib/mobile/organiser";

type Params = { orgSlug: string; eventId: string; rsvpId: string };

/** Reverses a decline with the dashboard's rules: confirmed when there is room, otherwise waitlisted. */
export const POST = eventRoute<Params>("POST /api/mobile/v1/orgs/:orgSlug/events/:eventId/guests/:rsvpId/reaccept", null, async (_request, { rsvpId }, { auth, event }) => {
  const result = await reacceptRsvpForUser(auth.userId, { organisationSlug: event.organisation.slug, eventId: event.event.id, rsvpId });
  if (!result.ok) return mobileActionError(result);
  const guest = await loadGuest(event, rsvpId);
  return guest ? mobileOk(guest) : notFound();
});
