/*
 * Hackathon result scores (docs/HACKATHON.md), as pure functions.
 *
 * For each judge with a submitted review of a submission:
 *   judgeScore = Σ(weight × score / maxScore) / Σ weight × 100
 * The result score is the mean of those judge scores, rounded to one decimal.
 * Submissions without a submitted review have no score (null) and no rank.
 * Ranks use standard competition ranking on the rounded score: ties share a
 * rank and the next rank skips (1, 1, 3).
 */

export type ScoreCriterion = { id: string; weight: number; maxScore: number };
export type ScoreEntry = { submissionId: string; judgeUserId: string; criterionId: string; score: number };
export type SubmittedReview = { submissionId: string; judgeUserId: string };

export type CriterionAverage = { criterionId: string; average: number | null };

export type SubmissionResult = {
  submissionId: string;
  /** 0..100, one decimal; null without a submitted review. */
  score: number | null;
  /** Judges whose submitted review counted. */
  judgesCounted: number;
  /** 1-based, shared on ties; null when there is no score. */
  rank: number | null;
  /** Mean raw score per criterion over the counted judges, one decimal. */
  criterionAverages: CriterionAverage[];
};

/** Round half away from zero to one decimal, without binary floating-point drift (72.25 -> 72.3). */
export function roundToOneDecimal(value: number): number {
  const rounded = Math.round(Math.abs(value) * 10 + 1e-9) / 10;
  return value < 0 ? -rounded : rounded;
}

/**
 * One judge's weighted percentage (unrounded). A criterion the judge did not
 * score counts as 0; scores are clamped to 0..maxScore. Null for an empty rubric.
 */
export function judgeWeightedPercent(criteria: readonly ScoreCriterion[], scoreFor: (criterionId: string) => number | undefined): number | null {
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (criteria.length === 0 || totalWeight <= 0) return null;
  let weighted = 0;
  for (const criterion of criteria) {
    if (criterion.maxScore <= 0) continue;
    const raw = scoreFor(criterion.id) ?? 0;
    const score = Math.min(Math.max(raw, 0), criterion.maxScore);
    weighted += (criterion.weight * score) / criterion.maxScore;
  }
  return (weighted / totalWeight) * 100;
}

/** Results for the given submissions, sorted by rank (unscored last, then input order). */
export function computeJudgingResults(input: {
  submissionIds: readonly string[];
  criteria: readonly ScoreCriterion[];
  scores: readonly ScoreEntry[];
  submittedReviews: readonly SubmittedReview[];
}): SubmissionResult[] {
  const scoreIndex = new Map<string, number>();
  for (const entry of input.scores) scoreIndex.set(`${entry.submissionId}\u0000${entry.judgeUserId}\u0000${entry.criterionId}`, entry.score);

  const judgesBySubmission = new Map<string, Set<string>>();
  for (const review of input.submittedReviews) {
    const judges = judgesBySubmission.get(review.submissionId) ?? new Set<string>();
    judges.add(review.judgeUserId);
    judgesBySubmission.set(review.submissionId, judges);
  }

  const results = input.submissionIds.map((submissionId, order) => {
    const judges = [...(judgesBySubmission.get(submissionId) ?? [])];
    const percents: number[] = [];
    for (const judgeUserId of judges) {
      const percent = judgeWeightedPercent(input.criteria, (criterionId) => scoreIndex.get(`${submissionId}\u0000${judgeUserId}\u0000${criterionId}`));
      if (percent != null) percents.push(percent);
    }
    const score = percents.length > 0 ? roundToOneDecimal(percents.reduce((sum, value) => sum + value, 0) / percents.length) : null;
    const criterionAverages = input.criteria.map((criterion) => {
      const values = judges
        .map((judgeUserId) => scoreIndex.get(`${submissionId}\u0000${judgeUserId}\u0000${criterion.id}`))
        .filter((value): value is number => value !== undefined);
      return {
        criterionId: criterion.id,
        average: values.length > 0 ? roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      };
    });
    return { order, result: { submissionId, score, judgesCounted: score == null ? 0 : percents.length, rank: null as number | null, criterionAverages } };
  });

  results.sort((a, b) => {
    if (a.result.score == null && b.result.score == null) return a.order - b.order;
    if (a.result.score == null) return 1;
    if (b.result.score == null) return -1;
    return b.result.score - a.result.score || a.order - b.order;
  });

  let previousScore: number | null = null;
  let previousRank = 0;
  results.forEach((entry, index) => {
    if (entry.result.score == null) return;
    entry.result.rank = entry.result.score === previousScore ? previousRank : index + 1;
    previousScore = entry.result.score;
    previousRank = entry.result.rank;
  });
  return results.map((entry) => entry.result);
}
