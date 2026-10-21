"use server";

import { auth } from "@/lib/auth";
import type { ActionResult } from "./org";
import { approveRsvpForUser, promoteFromWaitlistForUser, reacceptRsvpForUser, rejectRsvpForUser } from "@/lib/core/rsvpLifecycle";

/*
 * Thin Server Action wrappers. The RSVP lifecycle rules live in
 * lib/core/rsvpLifecycle.ts and are shared with the mobile API.
 */

async function currentUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function approveRsvp(input: unknown): Promise<ActionResult> {
  return approveRsvpForUser(await currentUserId(), input);
}

export async function rejectRsvp(input: unknown): Promise<ActionResult> {
  return rejectRsvpForUser(await currentUserId(), input);
}

/** Reverses a decline: confirmed when there is room, otherwise waitlisted. */
export async function reacceptRsvp(input: unknown): Promise<ActionResult<{ status: "CONFIRMED" | "WAITLISTED" }>> {
  return reacceptRsvpForUser(await currentUserId(), input);
}

export async function promoteFromWaitlist(input: unknown): Promise<ActionResult> {
  return promoteFromWaitlistForUser(await currentUserId(), input);
}
