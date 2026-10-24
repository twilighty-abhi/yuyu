"use server";

import { auth } from "@/lib/auth";
import type { ActionResult } from "./org";
import {
  checkInByRsvpIdForUser,
  checkInByTokenForUser,
  downloadOfflineCheckInRosterForUser,
  loadRecentCheckInsForUser,
  lookupAttendeesForCheckInForUser,
  previewCheckInByRsvpIdForUser,
  previewCheckInByTokenForUser,
  syncOfflineCheckInsForUser,
  undoCheckInForUser,
  type CheckInPreviewData,
  type CheckInResultData,
  type LookupRow,
  type OfflineCheckInRosterRow,
} from "@/lib/core/checkin";
import type { RecentCheckInsPage } from "@/lib/checkInRecent";

/*
 * Thin Server Action wrappers. The check-in rules live in lib/core/checkin.ts
 * and are shared with the mobile API, so both surfaces behave identically.
 */

export type { CheckInPreviewData, CheckInResultData, LookupRow, OfflineCheckInRosterRow };

async function currentUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function previewCheckInByToken(input: unknown): Promise<ActionResult<CheckInPreviewData>> {
  return previewCheckInByTokenForUser(await currentUserId(), input);
}

export async function checkInByToken(input: unknown): Promise<ActionResult<CheckInResultData>> {
  return checkInByTokenForUser(await currentUserId(), input);
}

export async function undoCheckIn(input: unknown): Promise<ActionResult> {
  return undoCheckInForUser(await currentUserId(), input);
}

export async function downloadOfflineCheckInRoster(
  input: unknown,
): Promise<ActionResult<{ generatedAt: string; rows: OfflineCheckInRosterRow[] }>> {
  return downloadOfflineCheckInRosterForUser(await currentUserId(), input);
}

export async function syncOfflineCheckIns(
  input: unknown,
): Promise<ActionResult<{ syncedIds: string[]; alreadyCheckedInIds: string[]; failed: { rsvpId: string; error: string }[] }>> {
  return syncOfflineCheckInsForUser(await currentUserId(), input);
}

export async function lookupAttendeesForCheckIn(input: unknown): Promise<ActionResult<{ rows: LookupRow[] }>> {
  return lookupAttendeesForCheckInForUser(await currentUserId(), input);
}

export async function previewCheckInByRsvpId(input: unknown): Promise<ActionResult<CheckInPreviewData>> {
  return previewCheckInByRsvpIdForUser(await currentUserId(), input);
}

export async function checkInByRsvpId(input: unknown): Promise<ActionResult<CheckInResultData>> {
  return checkInByRsvpIdForUser(await currentUserId(), input);
}

export async function loadRecentCheckIns(input: unknown): Promise<ActionResult<RecentCheckInsPage>> {
  return loadRecentCheckInsForUser(await currentUserId(), input);
}
