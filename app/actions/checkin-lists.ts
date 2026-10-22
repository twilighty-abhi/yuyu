"use server";

import { auth } from "@/lib/auth";
import type { ActionResult } from "./org";
import {
  checkInToListForUser,
  createCheckInListForUser,
  lookupListAttendeesForUser,
  reorderCheckInListsForUser,
  undoListCheckInForUser,
  updateCheckInListForUser,
  type CheckInListSummary,
  type ListCheckInResultData,
  type ListLookupRow,
} from "@/lib/core/checkinLists";

/*
 * Thin Server Action wrappers for custom check-in lists. The rules live in
 * lib/core/checkinLists.ts so the mobile API can reuse them unchanged.
 */

export type { CheckInListSummary, ListCheckInResultData, ListLookupRow };

async function currentUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function createCheckInList(input: unknown): Promise<ActionResult<CheckInListSummary>> {
  return createCheckInListForUser(await currentUserId(), input);
}

export async function updateCheckInList(input: unknown): Promise<ActionResult<CheckInListSummary>> {
  return updateCheckInListForUser(await currentUserId(), input);
}

export async function reorderCheckInLists(input: unknown): Promise<ActionResult> {
  return reorderCheckInListsForUser(await currentUserId(), input);
}

export async function checkInToList(input: unknown): Promise<ActionResult<ListCheckInResultData>> {
  return checkInToListForUser(await currentUserId(), input);
}

export async function undoListCheckIn(input: unknown): Promise<ActionResult> {
  return undoListCheckInForUser(await currentUserId(), input);
}

export async function lookupListAttendees(input: unknown): Promise<ActionResult<{ rows: ListLookupRow[] }>> {
  return lookupListAttendeesForUser(await currentUserId(), input);
}
