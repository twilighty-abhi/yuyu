import type { CheckInPreviewData, CheckInResultData, LookupRow } from "@/lib/core/checkin";
import { checkInPreviewSchema, checkInResultSchema, guestSchema } from "@/lib/mobile/schemas";

/* Mobile check-in DTOs. The QR token used by the web print flow is never returned here. */

export function toCheckInResult(data: CheckInResultData) {
  return checkInResultSchema.parse({
    rsvpId: data.rsvpId,
    displayName: data.displayName,
    email: data.email,
    status: data.status,
    alreadyCheckedIn: data.alreadyCheckedIn,
    checkedInAt: data.checkedInAt,
    checkInDetails: data.checkInDetails,
    registrationDetails: data.registrationDetails.map(({ label, value }) => ({ label, value })),
    ...(data.teamName ? { teamName: data.teamName } : {}),
  });
}

export function toCheckInPreview(data: CheckInPreviewData) {
  return checkInPreviewSchema.parse({ ...toCheckInResult(data), gate: data.gate });
}

export function lookupRowToGuest(row: LookupRow) {
  return guestSchema.parse({
    rsvpId: row.rsvpId,
    displayName: row.displayName,
    email: row.email,
    status: row.status,
    checkedInAt: row.checkedInAt,
    registeredAt: row.registeredAt,
    isGuest: row.isGuest ?? false,
    ...(row.teamName ? { teamName: row.teamName } : {}),
  });
}
