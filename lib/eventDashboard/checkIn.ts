import "server-only";

import type { EventDashboardContext } from "@/lib/eventDashboard/context";
import { loadRsvpStatusCounts } from "@/lib/eventDashboard/data";

/*
 * Data for the Check-in tab. Callers must already have checked
 * `ctx.permissions.canCheckIn`. Only booleans and counts leave this module:
 * the station PIN, its hash and its encrypted copy never do.
 */

export type CheckInDesk = {
  confirmed: number;
  checkedIn: number;
  /** A venue station PIN is set (boolean only). */
  stationEnabled: boolean;
  /** Station PIN actions are organisation-admin operations (app/actions/checkin-station.ts). */
  canManageStation: boolean;
  /** Mirrors /api/exports/events/[eventId]/attendees: org admins or the MANAGE_REGISTRATIONS grant. */
  canExportAttendance: boolean;
  /** The public station path for this event; the PIN is what protects it. */
  stationUrl: string;
};

export async function loadCheckInDesk(ctx: EventDashboardContext): Promise<CheckInDesk> {
  const { event, permissions, organisation, origin } = ctx;
  const counts = await loadRsvpStatusCounts(event.id);
  return {
    confirmed: counts.confirmed,
    checkedIn: counts.checkedIn,
    stationEnabled: Boolean(event.checkInStationPinHash),
    canManageStation: permissions.canManageCheckInStation,
    canExportAttendance: permissions.canExportAttendees,
    stationUrl: `${origin}/${organisation.slug}/${event.slug}/check-in`,
  };
}
