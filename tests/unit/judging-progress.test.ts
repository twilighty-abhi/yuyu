import { describe, expect, it } from "vitest";
import {
  autoAssignInputSchema,
  completionPercent,
  DEFAULT_REVIEWS_PER_PROJECT,
  effectiveReviewTarget,
  findOutliers,
  isStaleReview,
  judgingProgressQuerySchema,
  populationSd,
  reviewsPerProjectSchema,
} from "@/lib/judgingProgress";

describe("review target", () => {
  it("falls back to the default when unset or out of range", () => {
    expect(effectiveReviewTarget(null)).toBe(DEFAULT_REVIEWS_PER_PROJECT);
    expect(effectiveReviewTarget(undefined)).toBe(DEFAULT_REVIEWS_PER_PROJECT);
    expect(effectiveReviewTarget(0)).toBe(DEFAULT_REVIEWS_PER_PROJECT);
    expect(effectiveReviewTarget(21)).toBe(DEFAULT_REVIEWS_PER_PROJECT);
    expect(effectiveReviewTarget(5)).toBe(5);
  });

  it("accepts 1..20 whole numbers only", () => {
    expect(reviewsPerProjectSchema.safeParse("4").data).toBe(4);
    expect(reviewsPerProjectSchema.safeParse(0).success).toBe(false);
    expect(reviewsPerProjectSchema.safeParse(21).success).toBe(false);
    expect(reviewsPerProjectSchema.safeParse(2.5).success).toBe(false);
  });
});

describe("outliers", () => {
  it("computes the population standard deviation", () => {
    expect(populationSd([1])).toBeNull();
    expect(populationSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2);
  });

  it("flags a judge more than 2 SD from the other judges' mean", () => {
    const flags = findOutliers([
      { judgeUserId: "a", percent: 80 },
      { judgeUserId: "b", percent: 82 },
      { judgeUserId: "c", percent: 78 },
      { judgeUserId: "d", percent: 20 },
    ]);
    expect(flags).toEqual([{ judgeUserId: "d", score: 20, othersMean: 80, difference: -60, rule: "sd" }]);
  });

  it("flags nobody when judges broadly agree", () => {
    expect(
      findOutliers([
        { judgeUserId: "a", percent: 70 },
        { judgeUserId: "b", percent: 75 },
        { judgeUserId: "c", percent: 80 },
      ]),
    ).toEqual([]);
  });

  it("flags nobody when every score is the same", () => {
    expect(findOutliers([50, 50, 50].map((percent, index) => ({ judgeUserId: String(index), percent })))).toEqual([]);
  });

  it("uses 25 points when only two judges scored", () => {
    expect(findOutliers([{ judgeUserId: "a", percent: 60 }, { judgeUserId: "b", percent: 85 }])).toEqual([]);
    const flags = findOutliers([{ judgeUserId: "a", percent: 60 }, { judgeUserId: "b", percent: 85.5 }]);
    expect(flags.map((flag) => [flag.judgeUserId, flag.difference, flag.rule])).toEqual([
      ["a", -25.5, "fallback"],
      ["b", 25.5, "fallback"],
    ]);
  });

  it("never flags a lone judge", () => {
    expect(findOutliers([{ judgeUserId: "a", percent: 1 }])).toEqual([]);
    expect(findOutliers([])).toEqual([]);
  });
});

describe("stale reviews and completion", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  it("is stale after more than 24 hours", () => {
    expect(isStaleReview(new Date("2026-10-24T12:00:00Z"), now)).toBe(false);
    expect(isStaleReview(new Date("2026-10-24T11:59:00Z"), now)).toBe(true);
  });

  it("caps completion to 0..100", () => {
    expect(completionPercent(0, 0)).toBe(0);
    expect(completionPercent(1, 3)).toBe(33);
    expect(completionPercent(5, 3)).toBe(100);
  });
});

describe("input schemas", () => {
  it("validates progress pages", () => {
    expect(judgingProgressQuerySchema.parse({ section: "stale" })).toEqual({ section: "stale", page: 1 });
    expect(judgingProgressQuerySchema.safeParse({ section: "everything" }).success).toBe(false);
    expect(judgingProgressQuerySchema.safeParse({ section: "judges", page: 0 }).success).toBe(false);
    expect(judgingProgressQuerySchema.safeParse({ section: "judges", extra: 1 }).success).toBe(false);
  });

  it("validates automatic assignment options", () => {
    expect(autoAssignInputSchema.safeParse({ perProject: "3", mode: "keep", judgeUserIds: ["a"] }).success).toBe(true);
    expect(autoAssignInputSchema.safeParse({ perProject: 3, mode: "keep", judgeUserIds: [] }).success).toBe(false);
    expect(autoAssignInputSchema.safeParse({ perProject: 3, mode: "shuffle", judgeUserIds: ["a"] }).success).toBe(false);
    expect(autoAssignInputSchema.safeParse({ perProject: 30, mode: "keep", judgeUserIds: ["a"] }).success).toBe(false);
    expect(autoAssignInputSchema.safeParse({ perProject: 3, mode: "keep", judgeUserIds: Array.from({ length: 501 }, (_, i) => `j${i}`) }).success).toBe(false);
  });
});
