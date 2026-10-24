import { describe, expect, it } from "vitest";
import {
  isFullyScored,
  judgeProgressChip,
  judgeProgressSummary,
  judgingStatusNotice,
  linkLabel,
  scoreMapFrom,
  scoresToSave,
} from "@/components/event-dashboard/judging/judgeProgress";

const criteria = [
  { id: "c1", maxScore: 5 },
  { id: "c2", maxScore: 10 },
];

describe("judge workspace progress", () => {
  it("labels progress per submission", () => {
    expect(judgeProgressChip({ scoredCriteria: 0, reviewSubmitted: false }, 2)).toEqual({ label: "Not started", tone: "neutral" });
    expect(judgeProgressChip({ scoredCriteria: 1, reviewSubmitted: false }, 2)).toEqual({ label: "1 of 2 scored", tone: "warning" });
    expect(judgeProgressChip({ scoredCriteria: 2, reviewSubmitted: true }, 2)).toEqual({ label: "Review submitted", tone: "success" });
    // Scores for criteria since removed never push the count past the rubric.
    expect(judgeProgressChip({ scoredCriteria: 5, reviewSubmitted: false }, 2).label).toBe("2 of 2 scored");
  });

  it("summarises the judge's progress", () => {
    expect(
      judgeProgressSummary([
        { scoredCriteria: 2, reviewSubmitted: true },
        { scoredCriteria: 1, reviewSubmitted: false },
        { scoredCriteria: 0, reviewSubmitted: false },
      ]),
    ).toEqual({ total: 3, submitted: 1, started: 1, remaining: 2 });
  });

  it("explains when scoring is not open", () => {
    expect(judgingStatusNotice("OPEN")).toBeNull();
    expect(judgingStatusNotice("NOT_STARTED")?.title).toMatch(/not started/);
    expect(judgingStatusNotice("CLOSED")?.title).toMatch(/closed/);
  });
});

describe("judge workspace scores", () => {
  it("keeps only valid saved scores for the current rubric", () => {
    expect(
      scoreMapFrom(
        [
          { criterionId: "c1", score: 4 },
          { criterionId: "c2", score: 11 },
          { criterionId: "gone", score: 3 },
        ],
        criteria,
      ),
    ).toEqual({ c1: 4 });
  });

  it("sends entered scores in rubric order and nothing out of range", () => {
    expect(scoresToSave({ c2: 7, c1: 0 }, criteria)).toEqual([
      { criterionId: "c1", score: 0 },
      { criterionId: "c2", score: 7 },
    ]);
    expect(scoresToSave({ c1: 6, c2: 1.5 }, criteria)).toEqual([]);
  });

  it("needs every criterion before a review can be submitted", () => {
    expect(isFullyScored({ c1: 0 }, criteria)).toBe(false);
    expect(isFullyScored({ c1: 0, c2: 10 }, criteria)).toBe(true);
    expect(isFullyScored({}, [])).toBe(false);
  });

  it("labels project links by host", () => {
    expect(linkLabel("https://www.github.com/acme/app")).toBe("github.com");
    expect(linkLabel("not a url")).toBe("not a url");
  });
});
