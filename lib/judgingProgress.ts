import { z } from "zod";
import { roundToOneDecimal } from "@/lib/judgingScore";

/*
 * Judging → Progress (docs/HACKATHON.md, "Progress"), as pure functions so
 * the rules are unit tested without a database
 * (tests/unit/judging-progress.test.ts). The core in lib/core/judgingOps.ts
 * reads the event and feeds these.
 *
 * - Below target: a SUBMITTED project with fewer counted reviews than the
 *   target (`Event.reviewsPerProject`, or DEFAULT_REVIEWS_PER_PROJECT when
 *   unset). A counted review is the same as in the results: submitted, by
 *   someone who can still judge the event, with no conflict of interest.
 * - Outliers: for a project with counted reviews from n judges, a judge's
 *   weighted percentage is an outlier when it differs from the mean of the
 *   other judges' by more than twice the (population) standard deviation of
 *   all n percentages. With n = 2 there is no meaningful deviation, so the
 *   two judges are flagged when they differ by more than
 *   OUTLIER_FALLBACK_POINTS. One judge alone is never an outlier.
 * - Stale: a judge saved scores for a SUBMITTED project but has not
 *   submitted the review, and the last saved score is older than
 *   STALE_REVIEW_HOURS.
 */

/** "keep" adds to existing assignments; "replace" starts over (keeping any a judge has started). */
export const AUTO_ASSIGN_MODES = ["keep", "replace"] as const;
export type AutoAssignMode = (typeof AUTO_ASSIGN_MODES)[number];

/** Target judges per project when the organiser hasn't set one. */
export const DEFAULT_REVIEWS_PER_PROJECT = 3;
export const REVIEWS_PER_PROJECT_MIN = 1;
export const REVIEWS_PER_PROJECT_MAX = 20;
/** Rows per numbered page in each Progress list. */
export const JUDGING_PROGRESS_PAGE_SIZE = 25;
/** Points of disagreement that flag two judges when a deviation can't be measured. */
export const OUTLIER_FALLBACK_POINTS = 25;
/** Standard deviations from the other judges' mean that flag a score. */
export const OUTLIER_SD_MULTIPLIER = 2;
/** Hours after the last saved score that an unsubmitted review counts as stale. */
export const STALE_REVIEW_HOURS = 24;
/** Most judges one automatic assignment can draw from. */
export const AUTO_ASSIGN_POOL_MAX = 500;

export const JUDGING_PROGRESS_SECTIONS = ["below-target", "judges", "outliers", "stale"] as const;
export type JudgingProgressSection = (typeof JUDGING_PROGRESS_SECTIONS)[number];

export const reviewsPerProjectSchema = z.coerce.number().int().min(REVIEWS_PER_PROJECT_MIN).max(REVIEWS_PER_PROJECT_MAX);

export const judgingProgressQuerySchema = z
  .object({
    section: z.enum(JUDGING_PROGRESS_SECTIONS),
    page: z.number().int().min(1).max(10_000).optional().default(1),
  })
  .strict();

export const autoAssignInputSchema = z
  .object({
    perProject: reviewsPerProjectSchema,
    mode: z.enum(AUTO_ASSIGN_MODES),
    judgeUserIds: z.array(z.string().trim().min(1).max(128)).min(1, "Pick at least one judge.").max(AUTO_ASSIGN_POOL_MAX),
    /** Only on apply: the preview's fingerprint. */
    fingerprint: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export function effectiveReviewTarget(reviewsPerProject: number | null | undefined): number {
  return reviewsPerProject != null && reviewsPerProject >= REVIEWS_PER_PROJECT_MIN && reviewsPerProject <= REVIEWS_PER_PROJECT_MAX
    ? reviewsPerProject
    : DEFAULT_REVIEWS_PER_PROJECT;
}

export type JudgePercent = { judgeUserId: string; percent: number };
export type OutlierFlag = {
  judgeUserId: string;
  /** This judge's weighted percentage, one decimal. */
  score: number;
  /** Mean of the other judges' percentages, one decimal. */
  othersMean: number;
  /** score − othersMean, one decimal (negative when harsher). */
  difference: number;
  /** "sd" when measured against 2 SD; "fallback" for two judges more than 25 points apart. */
  rule: "sd" | "fallback";
};

/** Population standard deviation (null for fewer than two values). */
export function populationSd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Outlier judges for one project (see the rules above). */
export function findOutliers(scores: readonly JudgePercent[]): OutlierFlag[] {
  if (scores.length < 2) return [];
  const flags: OutlierFlag[] = [];
  const total = scores.reduce((sum, entry) => sum + entry.percent, 0);
  const sd = scores.length >= 3 ? populationSd(scores.map((entry) => entry.percent)) : null;
  for (const entry of scores) {
    const othersMean = (total - entry.percent) / (scores.length - 1);
    const difference = entry.percent - othersMean;
    const flagged = sd != null ? sd > 0 && Math.abs(difference) > OUTLIER_SD_MULTIPLIER * sd + 1e-9 : Math.abs(difference) > OUTLIER_FALLBACK_POINTS + 1e-9;
    if (!flagged) continue;
    flags.push({
      judgeUserId: entry.judgeUserId,
      score: roundToOneDecimal(entry.percent),
      othersMean: roundToOneDecimal(othersMean),
      difference: roundToOneDecimal(difference),
      rule: sd != null ? "sd" : "fallback",
    });
  }
  return flags;
}

/** Whether an unsubmitted review whose last score was saved at `lastSavedAt` is stale at `now`. */
export function isStaleReview(lastSavedAt: Date, now: Date): boolean {
  return now.getTime() - lastSavedAt.getTime() > STALE_REVIEW_HOURS * 3_600_000;
}

/** Whole-number completion percentage, capped to 0..100 (0 when nothing is expected). */
export function completionPercent(done: number, expected: number): number {
  if (expected <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((done / expected) * 100)));
}
