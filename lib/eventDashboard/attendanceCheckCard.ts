import "server-only";

import { EventStatus, RsvpStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ATTENDANCE_REMINDER_INTERVAL_MS, attendanceCheckOpen, type AttendanceSummary } from "@/lib/attendanceCheck";
import { loadAttendanceCheckStatus } from "@/lib/core/attendanceCheck";
import { formatDayTime, formatTimeZoneName } from "@/lib/format/datetime";

/**
 * Why the Emails tab's "Attendance confirmation" card cannot send right now.
 * Series occurrences never reach this card: the Emails tab belongs to one-off
 * Event rows, and series registrations live on EventInstance.
 */
export type AttendanceCheckCardClosed = "started" | "cancelled";

/** Everything the card renders. Counts only: no names or emails of guests. */
export type AttendanceCheckCardData = AttendanceSummary & {
  releaseOnDecline: boolean;
  closed: AttendanceCheckCardClosed | null;
  /** "Wed 28 Oct · 9:30 AM GMT+5:30", in the event timezone. */
  eventStartLabel: string;
  lastSent: { at: string; label: string; byName: string | null; recipientCount: number | null } | null;
  /** When the next unanswered guest becomes due a reminder (only while nobody is due now). */
  nextReminderLabel: string | null;
};

function dayTimeWithZone(value: Date, timeZone: string) {
  return `${formatDayTime(value, timeZone)} ${formatTimeZoneName(value, timeZone)}`.trim();
}

/**
 * Loads the card for an event the caller has already authorised to send
 * emails (`permissions.canSendEmails`, organisation OWNER/ADMIN).
 */
export async function loadAttendanceCheckCard(
  event: { id: string; organisationId: string; status: EventStatus; startDateTime: Date; timezone: string; attendanceCheckReleaseOnDecline: boolean },
  now: Date = new Date(),
): Promise<AttendanceCheckCardData> {
  const [status, oldestUnanswered] = await Promise.all([
    loadAttendanceCheckStatus(event, now),
    prisma.attendanceCheck.aggregate({
      where: { eventId: event.id, response: null, rsvp: { status: RsvpStatus.CONFIRMED } },
      _min: { sentAt: true },
    }),
  ]);
  const closed: AttendanceCheckCardClosed | null =
    event.status === EventStatus.CANCELLED ? "cancelled" : attendanceCheckOpen(event.startDateTime, now) ? null : "started";

  const oldest = oldestUnanswered._min.sentAt;
  const nextDue = oldest ? new Date(oldest.getTime() + ATTENDANCE_REMINDER_INTERVAL_MS) : null;
  const nextReminderLabel =
    !closed && status.remindable === 0 && nextDue && nextDue > now && nextDue < event.startDateTime ? dayTimeWithZone(nextDue, event.timezone) : null;

  return {
    asked: status.asked,
    coming: status.coming,
    notComing: status.notComing,
    noReply: status.noReply,
    notAsked: status.notAsked,
    remindable: status.remindable,
    released: status.released,
    releaseOnDecline: status.releaseOnDecline,
    closed,
    eventStartLabel: dayTimeWithZone(event.startDateTime, event.timezone),
    lastSent: status.lastSent
      ? { ...status.lastSent, label: dayTimeWithZone(new Date(status.lastSent.at), event.timezone) }
      : null,
    nextReminderLabel,
  };
}
