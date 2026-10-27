"use server";

import { auth } from "@/lib/auth";
import type { ActionResult } from "./org";
import { getRequestOrigin } from "@/lib/publicUrl";
import {
  issueAttendanceLinkForUser,
  previewAttendanceCheckSendForUser,
  remindAttendanceChecksForUser,
  respondToAttendanceCheck,
  sendAttendanceChecksForUser,
  setAttendanceReleaseOnDeclineForUser,
  type AttendanceReplyResult,
} from "@/lib/core/attendanceCheck";

/*
 * Thin Server Action wrappers for attendance confirmation
 * (lib/core/attendanceCheck.ts). Sending is always one of these explicit
 * organiser actions; nothing sends the question automatically.
 */

async function currentUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function previewAttendanceCheckSend(input: unknown): Promise<ActionResult<{ count: number; firstSend: boolean; eventStart: string }>> {
  return previewAttendanceCheckSendForUser(await currentUserId(), input);
}

export async function sendAttendanceChecks(input: unknown): Promise<ActionResult<{ queued: number }>> {
  return sendAttendanceChecksForUser(await currentUserId(), input);
}

export async function remindAttendanceChecks(input: unknown): Promise<ActionResult<{ queued: number }>> {
  return remindAttendanceChecksForUser(await currentUserId(), input);
}

export async function setAttendanceReleaseOnDecline(input: unknown): Promise<ActionResult<{ releaseOnDecline: boolean }>> {
  return setAttendanceReleaseOnDeclineForUser(await currentUserId(), input);
}

/** One guest's attendance link (absolute), to copy and send by hand. */
export async function issueAttendanceLink(input: unknown): Promise<ActionResult<{ url: string; replaced: boolean }>> {
  const result = await issueAttendanceLinkForUser(await currentUserId(), input);
  if (!result.ok || !result.data) return result.ok ? { ok: false, error: "Could not create the link. Please try again." } : result;
  return { ok: true, data: { url: `${await getRequestOrigin()}${result.data.path}`, replaced: result.data.replaced } };
}

/** The guest's answer on /attend/{token}; the link token is the only credential. */
export async function submitAttendanceReply(input: unknown): Promise<ActionResult<AttendanceReplyResult>> {
  return respondToAttendanceCheck(input);
}
