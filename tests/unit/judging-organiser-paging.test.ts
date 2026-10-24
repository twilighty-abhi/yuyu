import { describe, expect, it } from "vitest";
import {
  awardCandidatesQuerySchema,
  judgingResultsQuerySchema,
  matchesProjectQuery,
  numberedPage,
  numberedPageLabel,
  offsetPage,
  organiserSubmissionsQuerySchema,
} from "@/lib/judgingOrganiserPaging";

const rows = Array.from({ length: 121 }, (_, index) => index);

describe("numbered results pages", () => {
  it("slices an ordered list into fixed pages", () => {
    expect(numberedPage(rows, 1, 50)).toMatchObject({ page: 1, totalPages: 3, total: 121, start: 0, pageSize: 50 });
    expect(numberedPage(rows, 1, 50).rows).toEqual(rows.slice(0, 50));
    expect(numberedPage(rows, 3, 50).rows).toEqual([100, ...rows.slice(101)]);
    expect(numberedPage(rows, 3, 50).start).toBe(100);
  });

  it("clamps pages outside the range and handles an empty list", () => {
    expect(numberedPage(rows, 99, 50).page).toBe(3);
    expect(numberedPage(rows, 0, 50).page).toBe(1);
    expect(numberedPage(rows, Number.NaN, 50).page).toBe(1);
    expect(numberedPage([], 4, 50)).toEqual({ rows: [], page: 1, totalPages: 1, total: 0, start: 0, pageSize: 50 });
  });

  it("keeps the ranks it was given: ties straddling a page boundary stay shared", () => {
    const ranked = Array.from({ length: 60 }, (_, index) => ({ id: index, rank: index < 48 ? index + 1 : 49 }));
    const [first, second] = [numberedPage(ranked, 1, 50), numberedPage(ranked, 2, 50)];
    expect(first.rows.at(-1)?.rank).toBe(49);
    expect(second.rows[0]?.rank).toBe(49);
  });

  it("describes the slice shown", () => {
    expect(numberedPageLabel({ start: 50, total: 294, shown: 50 }, "ranked projects")).toBe("Showing 51–100 of 294 ranked projects");
    expect(numberedPageLabel({ start: 0, total: 0, shown: 0 }, "matching projects")).toBe("No matching projects");
  });
});

describe("award candidate steps", () => {
  it("returns the next offset until the list ends", () => {
    expect(offsetPage(rows, 0, 20)).toMatchObject({ total: 121, nextOffset: 20 });
    expect(offsetPage(rows, 100, 20)).toMatchObject({ rows: rows.slice(100, 120), nextOffset: 120 });
    expect(offsetPage(rows, 120, 20)).toMatchObject({ rows: [120], nextOffset: null });
    expect(offsetPage(rows, 500, 20)).toMatchObject({ rows: [], nextOffset: null });
  });
});

describe("project search", () => {
  it("matches the title or entrant name, case-insensitively", () => {
    const row = { title: "Byte Me", entrantName: "Team Ada" };
    expect(matchesProjectQuery(row, "")).toBe(true);
    expect(matchesProjectQuery(row, "  byte ")).toBe(true);
    expect(matchesProjectQuery(row, "ADA")).toBe(true);
    expect(matchesProjectQuery(row, "zebra")).toBe(false);
  });
});

describe("query schemas", () => {
  it("defaults and bounds the submissions query", () => {
    expect(organiserSubmissionsQuerySchema.parse({})).toEqual({ query: "", status: "all" });
    expect(organiserSubmissionsQuerySchema.safeParse({ status: "SUBMITTED", query: " x ", cursor: null }).data).toEqual({ status: "SUBMITTED", query: "x", cursor: null });
    expect(organiserSubmissionsQuerySchema.safeParse({ status: "PENDING" }).success).toBe(false);
    expect(organiserSubmissionsQuerySchema.safeParse({ query: "x".repeat(101) }).success).toBe(false);
    expect(organiserSubmissionsQuerySchema.safeParse({ cursor: "x".repeat(161) }).success).toBe(false);
    expect(organiserSubmissionsQuerySchema.safeParse({ eventId: "other" }).success).toBe(false);
  });

  it("accepts whole positive pages and offsets only", () => {
    expect(judgingResultsQuerySchema.parse({})).toEqual({ query: "", page: 1 });
    expect(judgingResultsQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(judgingResultsQuerySchema.safeParse({ page: 1.5 }).success).toBe(false);
    expect(judgingResultsQuerySchema.safeParse({ page: "2" }).success).toBe(false);
    expect(judgingResultsQuerySchema.safeParse({ page: 10_001 }).success).toBe(false);
    expect(awardCandidatesQuerySchema.parse({ offset: 40 })).toEqual({ query: "", offset: 40 });
    expect(awardCandidatesQuerySchema.safeParse({ offset: -20 }).success).toBe(false);
  });
});
