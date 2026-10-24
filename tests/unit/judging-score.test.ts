import { describe, expect, it } from "vitest";
import { computeJudgingResults, judgeWeightedPercent, roundToOneDecimal } from "@/lib/judgingScore";

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
