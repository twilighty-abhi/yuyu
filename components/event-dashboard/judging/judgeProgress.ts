import type { JudgingStatus } from "@prisma/client";
import type { ChipTone } from "@/components/ui/display";
import type { JudgeSubmissionCounts, JudgeSubmissionFilter } from "@/lib/judgingPaging";

/*
 * Pure helpers for the judge workspace: progress labels and the score map the
 * scoring form keeps. The server re-validates every score; these only shape
 * what the judge sees and sends.
 */

export type JudgeProgressItem = { scoredCriteria: number; reviewSubmitted: boolean };

/** Progress chip for one submission in the judge's list. */
export function judgeProgressChip(item: JudgeProgressItem, criteriaCount: number): { label: string; tone: ChipTone } {
  if (item.reviewSubmitted) return { label: "Review submitted", tone: "success" };
  const scored = Math.min(item.scoredCriteria, criteriaCount);
  if (scored === 0) return { label: "Not started", tone: "neutral" };
  return { label: `${scored} of ${criteriaCount} scored`, tone: "warning" };
}

/** Totals for the workspace header. */
export function judgeProgressSummary(items: readonly JudgeProgressItem[]) {
  const submitted = items.filter((item) => item.reviewSubmitted).length;
  const started = items.filter((item) => !item.reviewSubmitted && item.scoredCriteria > 0).length;
  return { total: items.length, submitted, started, remaining: items.length - submitted };
}

/**
 * Totals for the workspace header from the server's counts, which cover every
 * submission the judge may see, not only the pages loaded so far.
 */
export function judgeProgressFromCounts(counts: JudgeSubmissionCounts) {
  return { total: counts.all, submitted: counts.reviewed, started: counts.in_progress, remaining: counts.todo };
}

/** Filter chips for the judge's list, in display order. */
export const JUDGE_FILTER_OPTIONS: ReadonlyArray<{ value: JudgeSubmissionFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "todo", label: "To score" },
  { value: "in_progress", label: "In progress" },
  { value: "reviewed", label: "Reviewed" },
];

/** Empty-state text for a filtered or searched view that has no rows. */
export function judgeEmptyViewText(filter: JudgeSubmissionFilter, query: string): string {
  if (query.trim()) return "No submissions match that search.";
  if (filter === "todo") return "Nothing left to score. Every review is submitted.";
  if (filter === "in_progress") return "No reviews in progress.";
  if (filter === "reviewed") return "You haven't submitted any reviews yet.";
  return "No submissions in this view.";
}

/** Who is looking at the workspace: an organiser (owner/admin, inside the Judging tab) or a judge. */
export type WorkspaceAudience = "organiser" | "judge";

/** Banner text for the judging status; null when scoring is open. */
export function judgingStatusNotice(status: JudgingStatus, audience: WorkspaceAudience = "judge"): { title: string; body: string } | null {
  if (status === "OPEN") return null;
  if (status === "NOT_STARTED") {
    return audience === "organiser"
      ? { title: "Judging has not started", body: "You can read the submissions now. Open judging on the Setup tab when you're ready for judges to score." }
      : { title: "Judging has not started", body: "You can read the submissions now. Scoring opens when the organisers start judging." };
  }
  return { title: "Judging is closed", body: "Scores and reviews are final and can no longer be changed." };
}

/** Callout when the rubric is empty: organisers are told to add criteria, judges that there is nothing to score yet. */
export function noRubricNotice(audience: WorkspaceAudience): { title: string; body: string } {
  return audience === "organiser"
    ? { title: "No rubric yet", body: "Add at least one judging criterion to the rubric before you open judging. Judges score each project against it." }
    : { title: "No rubric yet", body: "The organisers have not added judging criteria, so there is nothing to score yet." };
}

export type ScoreMap = Record<string, number | undefined>;

/** The judge's saved scores as a map, keeping only criteria still in the rubric. */
export function scoreMapFrom(myScores: ReadonlyArray<{ criterionId: string; score: number }>, criteria: ReadonlyArray<{ id: string; maxScore: number }>): ScoreMap {
  const valid = new Map(criteria.map((criterion) => [criterion.id, criterion.maxScore]));
  const map: ScoreMap = {};
  for (const entry of myScores) {
    const max = valid.get(entry.criterionId);
    if (max !== undefined && Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= max) map[entry.criterionId] = entry.score;
  }
  return map;
}

/** Scores to send: entered values only, in rubric order. */
export function scoresToSave(map: ScoreMap, criteria: ReadonlyArray<{ id: string; maxScore: number }>): Array<{ criterionId: string; score: number }> {
  return criteria.flatMap((criterion) => {
    const score = map[criterion.id];
    return score !== undefined && Number.isInteger(score) && score >= 0 && score <= criterion.maxScore ? [{ criterionId: criterion.id, score }] : [];
  });
}

/** Every criterion has a score, so the review can be submitted. */
export function isFullyScored(map: ScoreMap, criteria: ReadonlyArray<{ id: string; maxScore: number }>): boolean {
  return criteria.length > 0 && scoresToSave(map, criteria).length === criteria.length;
}

/** A short label for a project link: the host name, without "www.". */
export function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
