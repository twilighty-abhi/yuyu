/*
 * Attendance confirmation ("Are you still coming?", docs/FEATURES.md): pure
 * rules shared by the server core (lib/core/attendanceCheck.ts), the
 * dashboard and the unit tests. No I/O.
 *
 * Nothing is ever sent automatically. An organiser who may email guests
 * sends the question from the Emails tab, and only CONFIRMED registrations
 * of a one-off event that have not been asked yet receive it.
 */

/** Longest optional note a guest can leave with their answer (a CHECK enforces it too). */
export const ATTENDANCE_NOTE_MAX = 500;

/** "Remind people who haven't replied" reaches one guest at most once per this interval. */
export const ATTENDANCE_REMINDER_INTERVAL_MS = 12 * 60 * 60_000;

export type AttendanceResponseValue = "ATTENDING" | "NOT_ATTENDING";

/** Per-guest state shown as a badge in Guests · People and at the check-in desk. */
export type AttendanceState = "coming" | "notComing" | "noReply" | "notAsked";

export const ATTENDANCE_STATES: readonly AttendanceState[] = ["coming", "notComing", "noReply", "notAsked"];

export const ATTENDANCE_STATE_LABELS: Record<AttendanceState, string> = {
  coming: "Coming",
  notComing: "Not coming",
  noReply: "No reply",
  notAsked: "Not asked",
};

/** The guest's state from their check (null when they were never asked). */
export function attendanceStateOf(check: { response: AttendanceResponseValue | null } | null | undefined): AttendanceState {
  if (!check) return "notAsked";
  if (check.response === "ATTENDING") return "coming";
  if (check.response === "NOT_ATTENDING") return "notComing";
  return "noReply";
}

/** The question can be sent (and answered) only before the event starts. */
export function attendanceCheckOpen(eventStart: Date, now: Date = new Date()): boolean {
  return now.getTime() < eventStart.getTime();
}

/** Who may receive the question: a CONFIRMED attendee (never crew, docs/CREW.md) of a one-off event. */
export function isAttendanceCheckRecipient(rsvp: { status: string; eventId: string | null; isCrew?: boolean }): boolean {
  return rsvp.status === "CONFIRMED" && rsvp.eventId != null && rsvp.isCrew !== true;
}

/** A guest who has not replied can be reminded once the last email is at least 12 hours old. */
export function isReminderDue(sentAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - sentAt.getTime() >= ATTENDANCE_REMINDER_INTERVAL_MS;
}

export type AttendanceReplyClosed = "cancelled" | "started" | "notConfirmed";

/** Why the reply form is closed, or null while the guest can still answer or change their answer. */
export function attendanceReplyClosedReason(input: { rsvpStatus: string; eventStart: Date; eventStatus?: string; now?: Date }): AttendanceReplyClosed | null {
  if (input.eventStatus === "CANCELLED") return "cancelled";
  if (!attendanceCheckOpen(input.eventStart, input.now ?? new Date())) return "started";
  if (input.rsvpStatus !== "CONFIRMED") return "notConfirmed";
  return null;
}

/** Parses the email's `?answer=` preselect; anything else selects nothing. */
export function parseAnswerPreselect(value: unknown): AttendanceResponseValue | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "yes") return "ATTENDING";
  if (raw === "no") return "NOT_ATTENDING";
  return null;
}

export type AttendanceSummary = {
  /** Guests asked so far (rows that still exist). */
  asked: number;
  coming: number;
  notComing: number;
  noReply: number;
  /** CONFIRMED guests who have never been asked (for example confirmed after the first send). */
  notAsked: number;
  /** Not-replied guests whose last email is at least 12 hours old. */
  remindable: number;
  /** Places released because a guest answered "No" while release was on. */
  released: number;
};

/** "Coming 12 · Not coming 3 · No reply 5": the Overview readiness line. */
export function describeAttendanceReplies(summary: Pick<AttendanceSummary, "coming" | "notComing" | "noReply">): string {
  return `Attendance: ${summary.coming} coming · ${summary.notComing} not coming · ${summary.noReply} no reply`;
}

/** Card copy for how many emails a send would queue. */
export function attendanceSendLabel(count: number, firstSend: boolean): string {
  if (count === 0) return firstSend ? "No confirmed guests to ask" : "Everyone confirmed has been asked";
  const people = `${count} ${count === 1 ? "guest" : "guests"}`;
  return firstSend ? `Ask ${people} to confirm` : `Ask ${people} newly confirmed`;
}
