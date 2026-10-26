/**
 * Organiser-controlled hackathon emails (docs/HACKATHON.md → Hackathon emails).
 *
 * Two outbox kinds are opt-in per event and OFF by default:
 * - `results-published` (Event.emailEntrantsOnResults): queued when results
 *   are published, or later with "Send results email now"
 *   (sendResultsAnnouncement in lib/core/judging.ts).
 * - `submission-received` (Event.emailSubmissionReceipts): the receipt queued
 *   when a project becomes SUBMITTED.
 *
 * Everything else is registration or capability email and ALWAYS goes out,
 * whatever these switches say: rsvp-confirmation, rsvp-status, team-created,
 * team-member-added, submission-link (the solo entrant's only way into the
 * submission form), email-verification, password-reset, invitations,
 * broadcasts, and attendance confirmations. Never gate those here.
 *
 * The gating is enforced on the server where the outbox rows are enqueued,
 * never only in the UI. This module holds the pure rules so they can be unit
 * tested; it has no database access.
 */

export const GATED_HACKATHON_EMAIL_KINDS = ["results-published", "submission-received"] as const;

export const ALWAYS_SENT_EMAIL_KINDS = [
  "rsvp-confirmation",
  "rsvp-status",
  "team-created",
  "team-member-added",
  "submission-link",
  "email-verification",
  "password-reset",
] as const;

export type HackathonEmailToggles = {
  emailEntrantsOnResults: boolean;
  emailSubmissionReceipts: boolean;
};

/** Both switches start off on every new and existing event. */
export const HACKATHON_EMAIL_DEFAULTS: HackathonEmailToggles = Object.freeze({
  emailEntrantsOnResults: false,
  emailSubmissionReceipts: false,
});

/** Whether submitting a project queues the `submission-received` receipt. */
export function shouldQueueSubmissionReceipt(event: Pick<HackathonEmailToggles, "emailSubmissionReceipts">): boolean {
  return event.emailSubmissionReceipts === true;
}

/** Whether publishing results queues the `results-published` announcement. */
export function shouldEmailOnPublish(event: Pick<HackathonEmailToggles, "emailEntrantsOnResults">): boolean {
  return event.emailEntrantsOnResults === true;
}

export type ResultsAnnouncementState =
  /** Results aren't published, so there is nothing to announce yet. */
  | "unpublished"
  /** This publication was announced (emails queued when it was published, or with "Send now"). */
  | "announced"
  /** Published without emailing, and the switch is still off. */
  | "off"
  /** Published without emailing, the switch is now on: "Send results email now" is offered. */
  | "ready";

type AnnouncementTimes = {
  resultsPublishedAt: Date | string | null;
  resultsAnnouncedAt: Date | string | null;
};

function time(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

/**
 * Whether the current publication has been announced. `resultsAnnouncedAt` is
 * set (to the publication time, or later with "Send now") whenever results
 * are emailed, so an announcement older than the current publication belongs
 * to an earlier one: results were unpublished after some copies were
 * delivered, then republished with the switch off. Entrants whose copy the
 * unpublish withdrew are still owed the email then.
 */
export function announcementCoversPublication(event: AnnouncementTimes): boolean {
  if (!event.resultsPublishedAt || !event.resultsAnnouncedAt) return false;
  return time(event.resultsAnnouncedAt) >= time(event.resultsPublishedAt);
}

/**
 * An earlier publication was announced (some entrants were emailed), but the
 * current one, or the next one, hasn't been: only those not told before are
 * emailed, which can be nobody.
 */
export function announcedBefore(event: AnnouncementTimes): boolean {
  return Boolean(event.resultsAnnouncedAt) && !announcementCoversPublication(event);
}

export function resultsAnnouncementState(event: AnnouncementTimes & { emailEntrantsOnResults: boolean }): ResultsAnnouncementState {
  if (!event.resultsPublishedAt) return "unpublished";
  if (announcementCoversPublication(event)) return "announced";
  return event.emailEntrantsOnResults ? "ready" : "off";
}

/**
 * Whether the publish or "Send results email now" dialog will show a
 * recipient count. Counting scans the outbox, so the dashboard skips it when
 * the switch is off or the current publication is already announced.
 */
export function needsAnnouncementCount(event: AnnouncementTimes & { emailEntrantsOnResults: boolean }): boolean {
  return event.emailEntrantsOnResults && resultsAnnouncementState(event) !== "announced";
}

/** Why "Send results email now" is refused, or null when it may queue the announcement. */
export function sendResultsAnnouncementRefusal(event: {
  submissionsEnabled: boolean;
  resultsPublishedAt: Date | null;
  emailEntrantsOnResults: boolean;
}): string | null {
  if (!event.submissionsEnabled) return "This event is not taking project submissions.";
  if (!event.resultsPublishedAt) return "Publish the results before emailing entrants.";
  if (!event.emailEntrantsOnResults) return "Turn on “Email entrants when results are published” in Judging → Setup first.";
  return null;
}

function entrants(count: number) {
  return `${count} entrant${count === 1 ? "" : "s"}`;
}

const NOBODY_CONFIRMED = "No entrants will be emailed: there are no confirmed registrations with an email address.";
const NOBODY_LEFT = "No entrants will be emailed: everyone with a confirmed registration was already emailed the results.";

function recipientsCopy(recipients: number, announcedEarlier: boolean, suffix: string): string {
  if (recipients > 0) return `${entrants(recipients)} will be emailed${suffix}.`;
  return announcedEarlier ? NOBODY_LEFT : NOBODY_CONFIRMED;
}

/**
 * The publish-results confirmation: what happens to email. `announcedEarlier`
 * (see announcedBefore): an earlier publication was announced, so only
 * entrants not told before are counted.
 */
export function publishResultsEmailCopy(emailOn: boolean, recipients: number, announcedEarlier = false): string {
  if (!emailOn) return "Results will be published without emailing entrants.";
  return recipientsCopy(recipients, announcedEarlier, "");
}

/** The "Send results email now" confirmation, with the SMTP sending-limit note. */
export function sendResultsEmailCopy(recipients: number, announcedEarlier = false): string {
  const who = recipientsCopy(recipients, announcedEarlier, " that the results are out");
  return `${who} Emails go out through your mail provider over the next few minutes, and a long list can run into its sending limits. This can only be sent once.`;
}

/** The Results tab's line about email, once results are published. */
export function publishedResultsEmailLine(state: ResultsAnnouncementState, announcedEarlier = false): string | null {
  if (state === "announced") return "Entrants were emailed that the results are out.";
  if (state === "off") {
    return announcedEarlier
      ? "Entrants weren't emailed when the results were republished, so anyone whose earlier email was withdrawn hasn't been told. To email them, turn on “Email entrants when results are published” in Judging → Setup."
      : "Entrants weren't emailed. To email them, turn on “Email entrants when results are published” in Judging → Setup.";
  }
  if (state === "ready") {
    return announcedEarlier
      ? "Some entrants were emailed before the results were unpublished; the rest haven't been told yet."
      : "Entrants haven't been emailed yet.";
  }
  return null;
}

/** The Results tab's line about email before publishing. */
export function unpublishedResultsEmailLine(emailOn: boolean): string {
  return emailOn
    ? "Publishing emails every confirmed entrant that the results are out."
    : "Publishing won't email entrants. You can turn that on in Judging → Setup.";
}
