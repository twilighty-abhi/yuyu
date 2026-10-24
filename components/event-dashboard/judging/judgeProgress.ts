import type { JudgingStatus } from "@prisma/client";
import type { ChipTone } from "@/components/ui/display";

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

/** Banner text for the judging status; null when scoring is open. */
export function judgingStatusNotice(status: JudgingStatus): { title: string; body: string } | null {
  if (status === "OPEN") return null;
  if (status === "NOT_STARTED") {
    return { title: "Judging has not started", body: "You can read the submissions now. Scoring opens when the organisers start judging." };
  }
  return { title: "Judging is closed", body: "Scores and reviews are final and can no longer be changed." };
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
