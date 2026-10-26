import { transitionTeamStatusForUser } from "@/lib/core/teamOrganiser";
import { eventRoute } from "@/lib/mobile/eventRoute";
import { mobileActionError, mobileOk, notFound } from "@/lib/mobile/http";
import { loadTeamForMobile } from "@/lib/mobile/teams";

type Params = { orgSlug: string; eventId: string; teamId: string };

/** Decline a pending or waitlisted team: every member is declined together. Same core, transaction, emails, webhooks and audit as the dashboard. */
export const POST = eventRoute<Params>("POST /api/mobile/v1/orgs/:orgSlug/events/:eventId/teams/:teamId/reject", null, async (_request, { teamId }, { auth, event }) => {
  const result = await transitionTeamStatusForUser(auth.userId, { organisationSlug: event.organisation.slug, eventId: event.event.id, teamId }, "reject");
  if (!result.ok) return mobileActionError(result);
  const team = await loadTeamForMobile({ userId: auth.userId, organisationId: event.organisation.id, orgSlug: event.organisation.slug, eventId: event.event.id, eventSlug: event.event.slug }, teamId);
  return team ? mobileOk(team) : notFound();
});
