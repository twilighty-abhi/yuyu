import type { EventStatus, JudgingStatus } from "@prisma/client";

/*
 * Copy for the organiser Judging panels that depends on state, kept apart from
 * the components so each case is unit-tested (tests/unit/judging-panel-copy.test.ts).
 */

/**
 * Warning while the event isn't live: entrants only reach the submission form
 * (ticket card, team page, `/submit/{token}`, account page) on a published
 * event, so turning submissions on for a draft collects nothing yet.
 */
export function eventNotLiveWarning(status: EventStatus): { title: string; body: string } | null {
  switch (status) {
    case "PUBLISHED":
      return null;
    case "DRAFT":
      return {
        title: "This event is still a draft.",
        body: "Entrants can't see the submission form, or submit, until you publish the event from the Overview tab.",
      };
    case "HIDDEN":
      return {
        title: "This event is offline.",
        body: "Entrants can't see the submission form, the project gallery or the results while the event page is taken down.",
      };
    case "CANCELLED":
      return {
        title: "This event is cancelled.",
        body: "Entrants can't see the submission form, the project gallery or the results of a cancelled event.",
      };
  }
}

/** The Results tab's hint before results are published, matched to where judging is. */
export function resultsPublishHint(status: JudgingStatus): string {
  switch (status) {
    case "NOT_STARTED":
      return "Judging hasn't started. Open judging on the Setup tab so judges can score, then close it to finalise the scores before you publish.";
    case "OPEN":
      return "Judging is open. Close judging on the Setup tab to finalise the scores before you publish.";
    case "CLOSED":
      return "Judging is closed and the scores are final. Pick winners on the Awards tab, then publish the results.";
  }
}

export type AwardWinners = { name: string; winners: ReadonlyArray<{ place: number; submissionId: string }> };

/** "Overall winner (1st place)" for each award a submission holds, in award order. */
export function awardsHeldBy(awards: ReadonlyArray<AwardWinners>, submissionId: string): string[] {
  const held: string[] = [];
  for (const award of awards) {
    for (const winner of award.winners) {
      if (winner.submissionId === submissionId) held.push(`${award.name} (${ordinal(winner.place)} place)`);
    }
  }
  return held;
}

export function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

/** What disqualifying does to awards and, once published, to the live results page. */
export function disqualifyImpact(input: { title: string; awardsHeld: string[]; resultsPublished: boolean }): string {
  const { title, awardsHeld, resultsPublished } = input;
  const awards = awardsHeld.length > 0 ? ` It loses ${awardsHeld.length === 1 ? "this award" : "these awards"}: ${awardsHeld.join(", ")}.` : "";
  const live = resultsPublished
    ? awardsHeld.length > 0
      ? " Results are published, so the live results page changes straight away and will show no winner in those places until you pick another on the Awards tab."
      : " Results are published; this project holds no award, so the live results page doesn't change."
    : "";
  const undo = awardsHeld.length > 0 ? " You can reinstate it later, but that doesn't give the awards back." : " You can reinstate it later.";
  return `"${title}" stops being judged and drops out of the ranking.${awards}${live}${undo}`;
}

/** Reinstating brings the project back to judging but never restores the awards it lost. */
export function reinstateImpact(input: { title: string; resultsPublished: boolean }): string {
  const base = `"${input.title}" goes back into judging and the ranking. Awards it lost when it was disqualified aren't given back: assign them again on the Awards tab if it should still win.`;
  return input.resultsPublished ? `${base} The live results page doesn't change until you do.` : base;
}

/**
 * The Ranking card's description and the toast for "Adjust for harsh/generous
 * judges" (Event.scoreNormalization; the formula is in lib/judgingScore.ts).
 */
export function scoreMethodCopy(method: "RAW" | "ZSCORE"): { description: string; savedToast: string } {
  return method === "ZSCORE"
    ? {
        description:
          "Ranked by the adjusted score: each judge's scores are rescaled so their own average is 50, so a harsh or generous judge moves projects as much as any other. Judges with fewer than 3 reviews, or who gave every project the same score, keep their raw scores. Projects with the same score share a rank.",
        savedToast: "Ranking now adjusts for harsh and generous judges.",
      }
    : {
        description: "Ranked by the raw score: each judge's weighted percentage, averaged over judges who submitted a review. Projects with the same score share a rank.",
        savedToast: "Ranking now uses raw scores.",
      };
}
