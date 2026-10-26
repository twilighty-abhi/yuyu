/*
 * The entrant's submission window as a phase and one line of copy
 * (docs/HACKATHON.md). Pure, so tests/unit/submission-window.test.ts covers it.
 */

export type SubmissionWindowPhase = "open" | "upcoming" | "closed" | "unscheduled" | "not-live";

export function windowPhase(window: { opensAt: Date | null; closesAt: Date | null; isOpen: boolean }, now: Date): SubmissionWindowPhase {
  if (window.isOpen) return "open";
  if (!window.opensAt || !window.closesAt) return "unscheduled";
  if (now < window.opensAt) return "upcoming";
  if (now >= window.closesAt) return "closed";
  // Inside the dates but not open: the event itself is not published.
  return "not-live";
}

export function windowText(view: { phase: SubmissionWindowPhase; opensLabel: string | null; closesLabel: string | null }): string {
  switch (view.phase) {
    case "open":
      return view.closesLabel ? `Submissions close ${view.closesLabel}.` : "Submissions are open.";
    case "upcoming":
      return view.opensLabel ? `Submissions open ${view.opensLabel}.` : "Submissions haven't opened yet.";
    case "closed":
      return "Submissions are closed.";
    case "unscheduled":
      return "The organisers haven't set the submission dates yet.";
    case "not-live":
      return "Submissions open once the organisers publish the event.";
  }
}

/** The first-submit confirmation. Receipts are opt-in per event, so the email is mentioned only when one was queued. */
export function submittedMessage(receiptQueued: boolean): string {
  return receiptQueued
    ? "Project submitted. We've emailed a confirmation. You can keep editing until submissions close."
    : "Project submitted. You can keep editing until submissions close.";
}
