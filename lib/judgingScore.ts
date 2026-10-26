/*
 * Hackathon result scores (docs/HACKATHON.md), as pure functions.
 *
 * For each judge with a submitted review of a submission:
 *   judgeScore = Σ(weight × score / maxScore) / Σ weight × 100
 * The result score is the mean of those judge scores, rounded to one decimal.
 * Submissions without a submitted review have no score (null) and no rank.
 * Ranks use standard competition ranking on the rounded score: ties share a
 * rank and the next rank skips (1, 1, 3).
 *
 * "Adjust for harsh/generous judges" (ZSCORE) standardises each judge first.
 * Over one judge's counted reviews (the `submittedReviews` given, on the
 * `submissionIds` given), with mean m and population standard deviation sd of
 * that judge's judge scores, each of their scores x becomes
 *   clamp(50 + 15 × (x − m) / sd, 0, 100)
 * A judge with fewer than ZSCORE_MIN_REVIEWS counted reviews, or with sd = 0
 * (every score the same), keeps their raw scores. The adjusted result score
 * is the mean of those per-judge scores, rounded the same way. Both scores
 * are always computed; `score` and `rank` follow the active method.
 */

export type ScoreNormalizationMethod = "RAW" | "ZSCORE";

/** Fewer counted reviews than this and a judge's scores are used raw: too few to estimate their scale. */
export const ZSCORE_MIN_REVIEWS = 3;
/** The adjusted scale: a judge's average lands on 50, one standard deviation is 15 points. */
export const ZSCORE_CENTRE = 50;
export const ZSCORE_SPREAD = 15;

export type ScoreCriterion = { id: string; weight: number; maxScore: number };
export type ScoreEntry = { submissionId: string; judgeUserId: string; criterionId: string; score: number };
export type SubmittedReview = { submissionId: string; judgeUserId: string };

export type CriterionAverage = { criterionId: string; average: number | null };

export type SubmissionResult = {
  submissionId: string;
  /** The active method's score (`rawScore` or `adjustedScore`), which ranks. */
  score: number | null;
  /** 0..100, one decimal; null without a submitted review. */
  rawScore: number | null;
  /** 0..100 on the adjusted scale, one decimal; null without a submitted review. */
  adjustedScore: number | null;
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

type JudgeScale = { mean: number; sd: number };

/**
 * Each judge's mean and population standard deviation over their judge
 * scores, for judges whose scores are standardised; judges left out of the
 * map keep raw scores (fewer than ZSCORE_MIN_REVIEWS reviews, or sd = 0).
 */
export function judgeScales(percentsByJudge: ReadonlyMap<string, readonly number[]>): Map<string, JudgeScale> {
  const scales = new Map<string, JudgeScale>();
  for (const [judgeUserId, values] of percentsByJudge) {
    if (values.length < ZSCORE_MIN_REVIEWS) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const sd = Math.sqrt(variance);
    if (!(sd > 1e-9)) continue;
    scales.set(judgeUserId, { mean, sd });
  }
  return scales;
}

/** One judge score on the adjusted scale; raw when the judge has no scale. */
export function adjustedJudgeScore(percent: number, scale: JudgeScale | undefined): number {
  if (!scale) return percent;
  const adjusted = ZSCORE_CENTRE + (ZSCORE_SPREAD * (percent - scale.mean)) / scale.sd;
  return Math.min(Math.max(adjusted, 0), 100);
}

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

/** Results for the given submissions, sorted by rank under `method` (unscored last, then input order). */
export function computeJudgingResults(input: {
  submissionIds: readonly string[];
  criteria: readonly ScoreCriterion[];
  scores: readonly ScoreEntry[];
  submittedReviews: readonly SubmittedReview[];
  /** Which score ranks; RAW when omitted. */
  method?: ScoreNormalizationMethod;
}): SubmissionResult[] {
  const method = input.method ?? "RAW";
  const scoreIndex = new Map<string, number>();
  for (const entry of input.scores) scoreIndex.set(`${entry.submissionId}\u0000${entry.judgeUserId}\u0000${entry.criterionId}`, entry.score);

  const included = new Set(input.submissionIds);
  const judgesBySubmission = new Map<string, Set<string>>();
  for (const review of input.submittedReviews) {
    if (!included.has(review.submissionId)) continue;
    const judges = judgesBySubmission.get(review.submissionId) ?? new Set<string>();
    judges.add(review.judgeUserId);
    judgesBySubmission.set(review.submissionId, judges);
  }

  // Every counted judge score, once, before any averaging.
  const percentsBySubmission = new Map<string, Array<{ judgeUserId: string; percent: number }>>();
  const percentsByJudge = new Map<string, number[]>();
  for (const [submissionId, judges] of judgesBySubmission) {
    const percents: Array<{ judgeUserId: string; percent: number }> = [];
    for (const judgeUserId of judges) {
      const percent = judgeWeightedPercent(input.criteria, (criterionId) => scoreIndex.get(`${submissionId}\u0000${judgeUserId}\u0000${criterionId}`));
      if (percent == null) continue;
      percents.push({ judgeUserId, percent });
      const own = percentsByJudge.get(judgeUserId) ?? [];
      own.push(percent);
      percentsByJudge.set(judgeUserId, own);
    }
    percentsBySubmission.set(submissionId, percents);
  }
  const scales = judgeScales(percentsByJudge);

  const results = input.submissionIds.map((submissionId, order) => {
    const judges = [...(judgesBySubmission.get(submissionId) ?? [])];
    const percents = percentsBySubmission.get(submissionId) ?? [];
    const rawScore = mean(percents.map((entry) => entry.percent));
    const adjustedScore = mean(percents.map((entry) => adjustedJudgeScore(entry.percent, scales.get(entry.judgeUserId))));
    const score = method === "ZSCORE" ? adjustedScore : rawScore;
    const criterionAverages = input.criteria.map((criterion) => {
      const values = judges
        .map((judgeUserId) => scoreIndex.get(`${submissionId}\u0000${judgeUserId}\u0000${criterion.id}`))
        .filter((value): value is number => value !== undefined);
      return {
        criterionId: criterion.id,
        average: values.length > 0 ? roundToOneDecimal(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
      };
    });
    return {
      order,
      result: { submissionId, score, rawScore, adjustedScore, judgesCounted: score == null ? 0 : percents.length, rank: null as number | null, criterionAverages },
    };
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
