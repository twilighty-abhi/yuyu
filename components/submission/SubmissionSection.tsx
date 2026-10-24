import "server-only";

import { loadEntrantSubmission, type EntrantAuth } from "@/lib/core/judging";
import { formatDayTime, formatTimeZoneName } from "@/lib/format/datetime";
import { safeTimeZone } from "@/lib/timeZone";
import type { SubmissionRef } from "@/app/actions/submissions";
import { SubmissionEditor, type SubmissionEditorView } from "./SubmissionEditor";
import { windowPhase } from "./submissionWindow";

/**
 * Loads the entrant's own submission through the core (which re-checks the
 * entrant's proof) and renders the editor. Renders nothing when the event
 * does not take submissions or the proof no longer holds. Dates are
 * formatted here in the event's timezone; the client gets labels only.
 */
export async function SubmissionSection({
  auth,
  submissionRef,
  variant = "card",
}: {
  auth: EntrantAuth;
  submissionRef: SubmissionRef;
  /** `page` renders the event title as the page heading (`/submit/{token}`, account page). */
  variant?: "card" | "page";
}) {
  const now = new Date();
  const view = await loadEntrantSubmission(auth, now);
  if (!view) return null;
  const timeZone = safeTimeZone(view.timezone);
  const label = (value: Date | null) => (value ? `${formatDayTime(value, timeZone)} ${formatTimeZoneName(value, timeZone)}` : null);

  const editorView: SubmissionEditorView = {
    entrantName: view.entrantName,
    isTeam: view.isTeam,
    eventTitle: view.eventTitle,
    phase: windowPhase(view.window, now),
    opensLabel: label(view.window.opensAt),
    closesLabel: label(view.window.closesAt),
    confirmed: view.confirmed,
    declined: view.declined,
    canEdit: view.canEdit,
    submission: view.submission
      ? {
          title: view.submission.title,
          summary: view.submission.summary,
          repoUrl: view.submission.repoUrl,
          demoUrl: view.submission.demoUrl,
          videoUrl: view.submission.videoUrl,
          status: view.submission.status,
          submittedLabel: label(view.submission.submittedAt),
        }
      : null,
  };

  return <SubmissionEditor submissionRef={submissionRef} view={editorView} variant={variant} />;
}
