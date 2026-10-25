import { describe, expect, it } from "vitest";
import {
  clampPage,
  decodeSubmissionCursor,
  encodeSubmissionCursor,
  galleryHref,
  JUDGE_SUBMISSION_FILTERS,
  judgeSubmissionsQuerySchema,
  parsePageParam,
  parseSearchParam,
  totalPagesFor,
} from "@/lib/judgingPaging";
import { judgeEmptyViewText, judgeProgressFromCounts, JUDGE_FILTER_OPTIONS } from "@/components/event-dashboard/judging/judgeProgress";

describe("judge workspace paging", () => {
  it("round-trips the keyset cursor and refuses malformed ones", () => {
    const row = { submittedAt: new Date("2035-01-01T10:00:00.123Z"), id: "cmsub_123-abc" };
    expect(decodeSubmissionCursor(encodeSubmissionCursor(row))).toEqual(row);
    for (const bad of ["", "abc", "123", ".id", "12.", "12.id;drop", "1e3.id", "-1.id", `${"9".repeat(16)}.id`, `1.${"x".repeat(129)}`]) {
      expect(decodeSubmissionCursor(bad), bad).toBeNull();
    }
  });

  it("bounds and defaults the query input", () => {
    expect(judgeSubmissionsQuerySchema.parse({})).toEqual({ query: "", filter: "all" });
    expect(judgeSubmissionsQuerySchema.parse({ query: "  robot ", filter: "todo", cursor: null })).toEqual({ query: "robot", filter: "todo", cursor: null });
    expect(judgeSubmissionsQuerySchema.safeParse({ query: "x".repeat(101) }).success).toBe(false);
    expect(judgeSubmissionsQuerySchema.safeParse({ filter: "scores" }).success).toBe(false);
    expect(judgeSubmissionsQuerySchema.safeParse({ cursor: "x".repeat(161) }).success).toBe(false);
    // Strict: a forged judge or event id cannot ride along with the query.
    expect(judgeSubmissionsQuerySchema.safeParse({ judgeUserId: "u2" }).success).toBe(false);
  });

  it("offers one chip per server filter and totals from the counts, not the page", () => {
    expect(JUDGE_FILTER_OPTIONS.map((option) => option.value)).toEqual([...JUDGE_SUBMISSION_FILTERS]);
    expect(judgeProgressFromCounts({ all: 250, todo: 180, in_progress: 12, reviewed: 70 })).toEqual({ total: 250, submitted: 70, started: 12, remaining: 180 });
  });

  it("explains an empty view", () => {
    expect(judgeEmptyViewText("all", " robot ")).toMatch(/match that search/);
    expect(judgeEmptyViewText("todo", "")).toMatch(/Nothing left to score/);
    expect(judgeEmptyViewText("reviewed", "")).toMatch(/haven't submitted/);
  });
});

describe("public gallery paging", () => {
  it("reads ?page= as a positive whole number", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("3")).toBe(3);
    expect(parsePageParam(["4", "9"])).toBe(4);
    for (const bad of ["0", "-2", "1.5", "abc", "1e3", "", "9999999"]) expect(parsePageParam(bad), bad).toBe(1);
  });

  it("normalises and bounds ?q=", () => {
    expect(parseSearchParam("  solar   car ")).toBe("solar car");
    expect(parseSearchParam(["a", "b"])).toBe("a");
    expect(parseSearchParam(undefined)).toBe("");
    expect(parseSearchParam("x".repeat(500))).toHaveLength(100);
  });

  it("counts pages and clamps the requested one", () => {
    expect(totalPagesFor(0, 24)).toBe(1);
    expect(totalPagesFor(24, 24)).toBe(1);
    expect(totalPagesFor(25, 24)).toBe(2);
    expect(totalPagesFor(247, 24)).toBe(11);
    expect(clampPage(0, 11)).toBe(1);
    expect(clampPage(5, 11)).toBe(5);
    expect(clampPage(40, 11)).toBe(11);
    expect(clampPage(3, 0)).toBe(1);
  });

  it("builds short, shareable links", () => {
    expect(galleryHref("/o/e/projects", { page: 1, query: "" })).toBe("/o/e/projects");
    expect(galleryHref("/o/e/projects", { page: 3, query: "" })).toBe("/o/e/projects?page=3");
    expect(galleryHref("/o/e/projects", { page: 2, query: "solar car" })).toBe("/o/e/projects?q=solar+car&page=2");
    expect(galleryHref("/o/e/projects", { page: 1, query: "a&b" })).toBe("/o/e/projects?q=a%26b");
  });
});
