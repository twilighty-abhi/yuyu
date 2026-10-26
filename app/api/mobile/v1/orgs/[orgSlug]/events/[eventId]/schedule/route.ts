import { eventRoute } from "@/lib/mobile/eventRoute";
import { mobileOk } from "@/lib/mobile/http";
import { loadOrganiserSchedule } from "@/lib/mobile/organiser";

// Read-only, so every organiser of the event may see it (the check-in desk
// included); changing a delay still needs `schedule`.
export const GET = eventRoute("GET /api/mobile/v1/orgs/:orgSlug/events/:eventId/schedule", null, async (_request, _params, { event, baseUrl }) =>
  mobileOk(await loadOrganiserSchedule(event, baseUrl)));
