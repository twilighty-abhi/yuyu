import { describe, expect, it } from "vitest";
import { adjustedJudgeScore, computeJudgingResults, judgeScales, judgeWeightedPercent, roundToOneDecimal, ZSCORE_MIN_REVIEWS } from "@/lib/judgingScore";

const criteria = [
  { id: "impact", weight: 3, maxScore: 10 },
  { id: "design", weight: 1, maxScore: 5 },
];

function scoresFor(submissionId: string, judgeUserId: string, impact: number, design: number) {
  return [
    { submissionId, judgeUserId, criterionId: "impact", score: impact },
    { submissionId, judgeUserId, criterionId: "design", score: design },
  ];
}

describe("result score formula", () => {
  it("is Σ(weight × score / maxScore) / Σ weight × 100 for one judge", () => {
    // (3 × 8/10 + 1 × 4/5) / 4 × 100 = (2.4 + 0.8) / 4 × 100 = 80
    expect(judgeWeightedPercent(criteria, (id) => ({ impact: 8, design: 4 } as Record<string, number>)[id])).toBeCloseTo(80);
    expect(judgeWeightedPercent(criteria, () => undefined)).toBe(0);
    expect(judgeWeightedPercent([], () => 1)).toBeNull();
  });

  it("averages judges with a submitted review and rounds to one decimal", () => {
    const results = computeJudgingResults({
      submissionIds: ["a"],
      criteria,
      scores: [...scoresFor("a", "j1", 8, 4), ...scoresFor("a", "j2", 7, 3), ...scoresFor("a", "j3", 0, 0)],
      // j3 saved scores but never submitted: not counted.
      submittedReviews: [{ submissionId: "a", judgeUserId: "j1" }, { submissionId: "a", judgeUserId: "j2" }],
    });
    // j1 = 80, j2 = (2.1 + 0.6) / 4 × 100 = 67.5 → mean 73.75 → 73.8
    expect(results).toEqual([
      {
        submissionId: "a",
        score: 73.8,
        rawScore: 73.8,
        // Neither judge has 3 reviews, so the adjusted score is the raw one.
        adjustedScore: 73.8,
        judgesCounted: 2,
        rank: 1,
        criterionAverages: [{ criterionId: "impact", average: 7.5 }, { criterionId: "design", average: 3.5 }],
      },
    ]);
  });

  it("gives no score or rank without a submitted review", () => {
    const [result] = computeJudgingResults({ submissionIds: ["a"], criteria, scores: scoresFor("a", "j1", 10, 5), submittedReviews: [] });
    expect(result).toMatchObject({ score: null, rank: null, judgesCounted: 0 });
  });

  it("shares ranks on ties (1, 1, 3) and puts unscored last", () => {
    const results = computeJudgingResults({
      submissionIds: ["unscored", "low", "tieA", "tieB"],
      criteria,
      scores: [...scoresFor("low", "j1", 2, 1), ...scoresFor("tieA", "j1", 9, 5), ...scoresFor("tieB", "j1", 9, 5)],
      submittedReviews: [
        { submissionId: "low", judgeUserId: "j1" },
        { submissionId: "tieA", judgeUserId: "j1" },
        { submissionId: "tieB", judgeUserId: "j1" },
      ],
    });
    expect(results.map((row) => [row.submissionId, row.rank])).toEqual([
      ["tieA", 1],
      ["tieB", 1],
      ["low", 3],
      ["unscored", null],
    ]);
  });

  it("treats scores equal after rounding as a tie", () => {
    const results = computeJudgingResults({
      submissionIds: ["a", "b"],
      criteria: [{ id: "c", weight: 1, maxScore: 3 }],
      // a: mean of 66.67 and 66.67 = 66.7; b: one judge 66.666… = 66.7
      scores: [
        { submissionId: "a", judgeUserId: "j1", criterionId: "c", score: 2 },
        { submissionId: "a", judgeUserId: "j2", criterionId: "c", score: 2 },
        { submissionId: "b", judgeUserId: "j1", criterionId: "c", score: 2 },
      ],
      submittedReviews: [{ submissionId: "a", judgeUserId: "j1" }, { submissionId: "a", judgeUserId: "j2" }, { submissionId: "b", judgeUserId: "j1" }],
    });
    expect(results.map((row) => [row.score, row.rank])).toEqual([[66.7, 1], [66.7, 1]]);
  });

  it("rounds halves up without floating-point drift", () => {
    expect(roundToOneDecimal(72.25)).toBe(72.3);
    expect(roundToOneDecimal(0.15)).toBe(0.2);
    expect(roundToOneDecimal(66.6666)).toBe(66.7);
    expect(roundToOneDecimal(100)).toBe(100);
  });
});

/*
 * "Adjust for harsh/generous judges" (ZSCORE), hand-computed. One criterion
 * out of 10 with weight 1, so a judge score is score × 10.
 */
const single = [{ id: "c", weight: 1, maxScore: 10 }];
function one(submissionId: string, judgeUserId: string, score: number) {
  return { submissionId, judgeUserId, criterionId: "c", score };
}

describe("judge normalisation (ZSCORE)", () => {
  // Harsh judge H: a=30, b=40, c=50 → mean 40, population sd √(200/3) = 8.16497.
  // Generous judge G: d=80, e=90, f=100 → mean 90, same sd.
  // z = ±1.22474 → 50 ± 15 × 1.22474 = 68.3712 / 31.6288, and 50 at the mean.
  const harshAndGenerous = {
    submissionIds: ["a", "b", "c", "d", "e", "f"],
    criteria: single,
    scores: [one("a", "H", 3), one("b", "H", 4), one("c", "H", 5), one("d", "G", 8), one("e", "G", 9), one("f", "G", 10)],
    submittedReviews: ["a", "b", "c"].map((id) => ({ submissionId: id, judgeUserId: "H" })).concat(["d", "e", "f"].map((id) => ({ submissionId: id, judgeUserId: "G" }))),
  };

  it("computes the per-judge scale with the population standard deviation", () => {
    const scales = judgeScales(new Map([["H", [30, 40, 50]], ["few", [10, 90]], ["flat", [60, 60, 60, 60]]]));
    expect(scales.get("H")?.mean).toBeCloseTo(40, 10);
    expect(scales.get("H")?.sd).toBeCloseTo(Math.sqrt(200 / 3), 10);
    expect(ZSCORE_MIN_REVIEWS).toBe(3);
    // Fewer than 3 reviews, or sd = 0: no scale, so raw scores are kept.
    expect(scales.has("few")).toBe(false);
    expect(scales.has("flat")).toBe(false);
    expect(adjustedJudgeScore(50, scales.get("H"))).toBeCloseTo(68.3712, 4);
    expect(adjustedJudgeScore(30, scales.get("H"))).toBeCloseTo(31.6288, 4);
    expect(adjustedJudgeScore(77, undefined)).toBe(77);
  });

  it("ranks by the raw score under RAW and keeps both scores", () => {
    const results = computeJudgingResults({ ...harshAndGenerous, method: "RAW" });
    expect(results.map((row) => [row.submissionId, row.score, row.rawScore, row.adjustedScore, row.rank])).toEqual([
      ["f", 100, 100, 68.4, 1],
      ["e", 90, 90, 50, 2],
      ["d", 80, 80, 31.6, 3],
      ["c", 50, 50, 68.4, 4],
      ["b", 40, 40, 50, 5],
      ["a", 30, 30, 31.6, 6],
    ]);
    // RAW is the default.
    expect(computeJudgingResults(harshAndGenerous)).toEqual(results);
  });

  it("ranks by the adjusted score under ZSCORE, so each judge's best project ties", () => {
    const results = computeJudgingResults({ ...harshAndGenerous, method: "ZSCORE" });
    expect(results.map((row) => [row.submissionId, row.score, row.rawScore, row.rank])).toEqual([
      ["c", 68.4, 50, 1],
      ["f", 68.4, 100, 1],
      ["b", 50, 40, 3],
      ["e", 50, 90, 3],
      ["a", 31.6, 30, 5],
      ["d", 31.6, 80, 5],
    ]);
    expect(results.every((row) => row.judgesCounted === 1)).toBe(true);
  });

  it("averages normalised scores per project and falls back to raw for judges with too few reviews", () => {
    // H as above, plus N (two reviews: c=90, f=20) who keeps raw scores.
    const results = computeJudgingResults({
      ...harshAndGenerous,
      scores: [...harshAndGenerous.scores, one("c", "N", 9), one("f", "N", 2)],
      submittedReviews: [...harshAndGenerous.submittedReviews, { submissionId: "c", judgeUserId: "N" }, { submissionId: "f", judgeUserId: "N" }],
      method: "ZSCORE",
    });
    const byId = new Map(results.map((row) => [row.submissionId, row]));
    // c: (68.3712 + 90) / 2 = 79.1856 → 79.2; raw (50 + 90) / 2 = 70.
    expect(byId.get("c")).toMatchObject({ adjustedScore: 79.2, rawScore: 70, score: 79.2, judgesCounted: 2, rank: 1 });
    // f: (68.3712 + 20) / 2 = 44.1856 → 44.2; raw (100 + 20) / 2 = 60.
    expect(byId.get("f")).toMatchObject({ adjustedScore: 44.2, rawScore: 60, score: 44.2, rank: 4 });
  });

  it("keeps raw scores for a judge whose scores are all the same", () => {
    const results = computeJudgingResults({
      submissionIds: ["a", "b", "c"],
      criteria: single,
      scores: [one("a", "F", 7), one("b", "F", 7), one("c", "F", 7)],
      submittedReviews: ["a", "b", "c"].map((id) => ({ submissionId: id, judgeUserId: "F" })),
      method: "ZSCORE",
    });
    expect(results.map((row) => [row.adjustedScore, row.rawScore, row.rank])).toEqual([[70, 70, 1], [70, 70, 1], [70, 70, 1]]);
  });

  it("clamps the adjusted score to 0..100", () => {
    // 19 zeros and one 10: mean 5, sd √475 = 21.7945; z(100) = 4.359 → 115.4, clamped to 100; z(0) = -0.2294 → 46.56.
    const ids = Array.from({ length: 20 }, (_, index) => `p${index}`);
    const results = computeJudgingResults({
      submissionIds: ids,
      criteria: single,
      scores: ids.map((id, index) => one(id, "O", index === 0 ? 10 : 0)),
      submittedReviews: ids.map((id) => ({ submissionId: id, judgeUserId: "O" })),
      method: "ZSCORE",
    });
    expect(results[0]).toMatchObject({ submissionId: "p0", adjustedScore: 100, rawScore: 100, rank: 1 });
    expect(results[1]).toMatchObject({ adjustedScore: 46.6, rawScore: 0, rank: 2 });
  });

  it("only uses the counted reviews passed in (revoked or conflicted judges are already left out)", () => {
    // H's review of "x" is not counted, so H's scale comes from a, b, c only and "x" is not a project here.
    const results = computeJudgingResults({
      ...harshAndGenerous,
      scores: [...harshAndGenerous.scores, one("x", "H", 10)],
      method: "ZSCORE",
    });
    expect(results.find((row) => row.submissionId === "c")?.adjustedScore).toBe(68.4);
    // A review of a project outside `submissionIds` (e.g. disqualified) does not shift the judge's scale either.
    const withOutside = computeJudgingResults({
      ...harshAndGenerous,
      scores: [...harshAndGenerous.scores, one("x", "H", 10)],
      submittedReviews: [...harshAndGenerous.submittedReviews, { submissionId: "x", judgeUserId: "H" }],
      method: "ZSCORE",
    });
    expect(withOutside.find((row) => row.submissionId === "c")?.adjustedScore).toBe(68.4);
  });
});
