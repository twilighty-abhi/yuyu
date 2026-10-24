import { describe, expect, it } from "vitest";
import {
  RATING_DOTS,
  isRatingField,
  isTextField,
  questionTypeLabel,
  ratingDistribution,
  ratingScale,
} from "@/components/event-dashboard/feedback/helpers";
import {
  PERMISSION_OPTIONS,
  inviteExpiryLabel,
  permissionChipLabels,
  togglePermission,
} from "@/components/event-dashboard/settings/helpers";

describe("feedback rating detection", () => {
  it("treats single-choice questions with all-numeric options as ratings", () => {
    expect(isRatingField({ type: "RADIO", options: ["1", "2", "3", "4", "5"] })).toBe(true);
    expect(isRatingField({ type: "SELECT", options: [" 0 ", "10"] })).toBe(true);
    expect(isRatingField({ type: "RADIO", options: ["1.5", "-1"] })).toBe(true);
  });

  it("rejects word options, single options, multi-select and free text", () => {
    // Known word scales count as ratings (the built-in templates use them); unknown words don't.
    expect(isRatingField({ type: "RADIO", options: ["Excellent", "Good", "Okay", "Poor"] })).toBe(true);
    expect(isRatingField({ type: "RADIO", options: ["Definitely", "Probably", "Not sure", "Probably not"] })).toBe(true);
    expect(isRatingField({ type: "RADIO", options: ["Red", "Green", "Blue"] })).toBe(false);
    expect(isRatingField({ type: "RADIO", options: ["Excellent", "Agree"] })).toBe(false);
    expect(isRatingField({ type: "RADIO", options: ["1", "2", "lots"] })).toBe(false);
    expect(isRatingField({ type: "RADIO", options: ["5"] })).toBe(false);
    expect(isRatingField({ type: "MULTI_SELECT", options: ["1", "2", "3"] })).toBe(false);
    expect(isRatingField({ type: "TEXT", options: [] })).toBe(false);
    expect(isRatingField({ type: "RADIO", options: ["1e3", "2"] })).toBe(false);
  });

  it("identifies text questions", () => {
    expect(isTextField({ type: "TEXT" })).toBe(true);
    expect(isTextField({ type: "TEXTAREA" })).toBe(true);
    expect(isTextField({ type: "RADIO" })).toBe(false);
  });

  it("labels question types in plain language", () => {
    expect(questionTypeLabel({ type: "RADIO", options: ["1", "2", "3", "4", "5"] })).toBe("Rating 1–5");
    expect(questionTypeLabel({ type: "TEXTAREA", options: [] })).toBe("Long answer");
    expect(questionTypeLabel({ type: "CHECKBOX", options: [] })).toBe("Yes / no");
    expect(questionTypeLabel({ type: "RADIO", options: ["Yes", "No"] })).toBe("Pick one");
  });
});

describe("feedback rating distribution", () => {
  it("orders the highest rating first and scales dots to the busiest row", () => {
    const result = ratingDistribution(["1", "2", "3", "4", "5"], { "5": 9, "4": 6, "3": 2, "2": 1 });
    expect(result.rows.map((row) => row.value)).toEqual(["5", "4", "3", "2", "1"]);
    expect(result.rows.map((row) => row.count)).toEqual([9, 6, 2, 1, 0]);
    expect(result.rows[0]!.dots).toBe(RATING_DOTS);
    expect(result.rows.map((row) => row.dots)).toEqual([10, 7, 2, 1, 0]);
    expect(result.total).toBe(18);
    expect(result.average).toBeCloseTo((5 * 9 + 4 * 6 + 3 * 2 + 2) / 18);
  });

  it("gives any non-zero count at least one dot", () => {
    const result = ratingDistribution(["1", "2"], { "2": 500, "1": 1 });
    expect(result.rows.find((row) => row.value === "1")!.dots).toBe(1);
  });

  it("ignores answers that no longer match an option and handles no answers", () => {
    const result = ratingDistribution(["1", "2", "3"], { "7": 4, "2": 1 });
    expect(result.total).toBe(1);
    expect(result.rows.every((row) => row.value !== "7")).toBe(true);
    const empty = ratingDistribution(["1", "2", "3"], {});
    expect(empty.total).toBe(0);
    expect(empty.average).toBeNull();
    expect(empty.rows.every((row) => row.dots === 0)).toBe(true);
  });

  it("de-duplicates options and sanitises counts", () => {
    const result = ratingDistribution(["1", " 1", "2"], { "1": -3, "2": 2.7 });
    expect(result.rows.map((row) => row.value)).toEqual(["2", "1"]);
    expect(result.rows.map((row) => row.count)).toEqual([2, 0]);
  });
});

describe("co-organiser permission helpers", () => {
  it("returns short chip labels in canonical order without duplicates or unknown values", () => {
    expect(permissionChipLabels(["CHECK_IN", "EDIT_DETAILS", "CHECK_IN", "SOMETHING_ELSE"])).toEqual(["Edit details", "Check-in"]);
    expect(permissionChipLabels([])).toEqual([]);
    expect(PERMISSION_OPTIONS).toHaveLength(6);
    expect(permissionChipLabels(["JUDGE"])).toEqual(["Judge"]);
  });

  it("toggles a permission on and off, keeping canonical order", () => {
    expect(togglePermission(["CHECK_IN"], "EDIT_DETAILS")).toEqual(["EDIT_DETAILS", "CHECK_IN"]);
    expect(togglePermission(["EDIT_DETAILS", "CHECK_IN"], "EDIT_DETAILS")).toEqual(["CHECK_IN"]);
    expect(togglePermission([], "PUBLISH_AND_SCHEDULE")).toEqual(["PUBLISH_AND_SCHEDULE"]);
  });

  it("describes when an invite expires", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(inviteExpiryLabel(new Date("2026-10-14T18:00:00Z"), now)).toBe("Invite expires today");
    expect(inviteExpiryLabel(new Date("2026-10-15T13:00:00Z"), now)).toBe("Invite expires tomorrow");
    expect(inviteExpiryLabel("2026-10-20T13:00:00Z", now)).toBe("Invite expires in 6 days");
    expect(inviteExpiryLabel(new Date("2026-10-13T12:00:00Z"), now)).toBe("Invite expired");
  });
});

describe("word-scale ratings", () => {
  it("orders word answers best first, reports the most common answer and no average", () => {
    const field = { type: "RADIO" as const, options: ["Poor", "Okay", "excellent", "Good"] };
    const scale = ratingScale(field);
    expect(scale?.kind).toBe("words");
    const result = ratingDistribution(field.options, { excellent: 2, Good: 5, Okay: 5, Poor: 1 }, 10, scale ?? undefined);
    expect(result.rows.map((row) => row.value)).toEqual(["excellent", "Good", "Okay", "Poor"]);
    expect(result.total).toBe(13);
    expect(result.average).toBeNull();
    expect(result.top).toBe("Good");
    expect(questionTypeLabel(field)).toBe("Rating excellent–Poor");
  });

  it("keeps numeric scales unchanged", () => {
    const result = ratingDistribution(["1", "2", "3"], { "3": 2, "1": 2 }, 10, { kind: "numeric" });
    expect(result.rows.map((row) => row.value)).toEqual(["3", "2", "1"]);
    expect(result.average).toBe(2);
    expect(result.top).toBe("3");
  });
});
