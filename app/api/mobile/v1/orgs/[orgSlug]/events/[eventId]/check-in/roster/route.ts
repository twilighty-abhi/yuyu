import { downloadOfflineCheckInRosterForUser } from "@/lib/core/checkin";
import { eventRoute } from "@/lib/mobile/eventRoute";
import { mobileActionError, mobileError, mobileOk } from "@/lib/mobile/http";
import { rosterDtoSchema } from "@/lib/mobile/schemas";

/** The offline roster includes ticket tokens; it requires the exact CHECK_IN permission (checked in the core). */
export const GET = eventRoute("GET /api/mobile/v1/orgs/:orgSlug/events/:eventId/check-in/roster", null, async (_request, _params, { auth, event }) => {
  const result = await downloadOfflineCheckInRosterForUser(auth.userId, { organisationSlug: event.organisation.slug, eventId: event.event.id });
  if (!result.ok) return mobileActionError(result);
  if (!result.data) return mobileError("INTERNAL_ERROR");
  return mobileOk(rosterDtoSchema.parse({
    generatedAt: result.data.generatedAt,
    rows: result.data.rows.map((row) => ({
      rsvpId: row.rsvpId,
      displayName: row.displayName,
      email: row.email,
      status: row.status,
      checkedInAt: row.checkedInAt,
      registeredAt: row.registeredAt,
      isGuest: row.isGuest ?? false,
      ...(row.teamName ? { teamName: row.teamName } : {}),
      ticketToken: row.ticketToken,
      checkInDetails: row.checkInDetails,
      registrationDetails: row.registrationDetails.map(({ label, value }) => ({ label, value })),
    })),
  }));
});
