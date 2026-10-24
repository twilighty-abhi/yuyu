import { describe, expect, it } from "vitest";
import {
  SAVED_VIEW_SURFACES,
  SURFACE_PARAMS,
  VIEW_PRESETS,
  VIEW_URL_KEYS,
  applyViewParamsToUrl,
  clearViewParamsFromUrl,
  presetsFor,
  sameViewParams,
  sanitizeViewParams,
  savedViewNameSchema,
  viewLink,
  viewParam,
  viewParamsFromSearchParams,
} from "@/lib/savedViews";
import { countScoreFilters, matchesScoreFilter, judgingResultsQuerySchema } from "@/lib/judgingOrganiserPaging";
import { attendeeStatusWhere, parseAttendeeViewSearchParams } from "@/lib/attendeeListQuery";

describe("saved view params", () => {
  it("keeps only allow-listed keys and values, and drops defaults", () => {
    expect(sanitizeViewParams("GUESTS_PEOPLE", { status: "waitlist", kind: "all", team: "solo", q: "  Asha  ", cursor: "1.x", eventId: "evil" })).toEqual({
      q: "Asha",
      status: "waitlist",
      team: "solo",
    });
    expect(sanitizeViewParams("GUESTS_PEOPLE", { status: "OWNER", kind: 3, team: ["solo"] })).toEqual({});
    expect(sanitizeViewParams("GUESTS_TEAMS", { status: "looking", show: "stale" })).toEqual({ status: "looking" });
    expect(sanitizeViewParams("JUDGING_SUBMISSIONS", { status: "notSubmitted" })).toEqual({ status: "notSubmitted" });
    expect(sanitizeViewParams("JUDGING_SUBMISSIONS", { status: "checkedIn" })).toEqual({});
    expect(sanitizeViewParams("JUDGING_RESULTS", { scored: "underTwo", page: "3" })).toEqual({ scored: "underTwo" });
    expect(sanitizeViewParams("JUDGING_PROGRESS", { show: "below-target", q: "x" })).toEqual({ show: "below-target" });
  });

  it("refuses non-objects and prototype tricks", () => {
    expect(sanitizeViewParams("GUESTS_PEOPLE", null)).toEqual({});
    expect(sanitizeViewParams("GUESTS_PEOPLE", "status=waitlist")).toEqual({});
    expect(sanitizeViewParams("GUESTS_PEOPLE", ["waitlist"])).toEqual({});
    expect(sanitizeViewParams("GUESTS_PEOPLE", JSON.parse('{"__proto__": {"status": "waitlist"}}'))).toEqual({});
    expect(sanitizeViewParams("NOPE" as never, { status: "waitlist" })).toEqual({});
  });

  it("cleans and bounds search text", () => {
    expect(sanitizeViewParams("GUESTS_TEAMS", { q: "<script>\u0000team" })).toEqual({ q: "script team" });
    expect(sanitizeViewParams("GUESTS_TEAMS", { q: "x".repeat(101) })).toEqual({});
    expect(sanitizeViewParams("GUESTS_TEAMS", { q: "   " })).toEqual({});
  });

  it("round-trips through the address bar and clears other surfaces' keys", () => {
    const url = new URL("https://yuyu.example/dashboard/club/event/e1?tab=guests&sub=people&status=waitlist&scored=unscored&show=judges");
    expect(viewParamsFromSearchParams("GUESTS_PEOPLE", url.searchParams)).toEqual({ status: "waitlist" });
    applyViewParamsToUrl(url, "JUDGING_RESULTS", { scored: "unscored", q: "robo", status: "x" });
    expect(url.searchParams.get("tab")).toBe("guests");
    expect(url.searchParams.get("status")).toBeNull();
    expect(url.searchParams.get("show")).toBeNull();
    expect(url.searchParams.get("scored")).toBe("unscored");
    expect(url.searchParams.get("q")).toBe("robo");
    clearViewParamsFromUrl(url);
    expect([...url.searchParams.keys()]).toEqual(["tab", "sub"]);
    expect(VIEW_URL_KEYS).toEqual(expect.arrayContaining(["status", "kind", "team", "q", "scored", "show"]));
  });

  it("builds a link to the surface's tab with the view applied", () => {
    const link = new URL(viewLink("https://yuyu.example/dashboard/club/event/e1?tab=overview&q=old", "JUDGING_SUBMISSIONS", { status: "DRAFT" }));
    expect(link.searchParams.get("tab")).toBe("judging");
    expect(link.searchParams.get("sub")).toBe("judging-submissions");
    expect(link.searchParams.get("status")).toBe("DRAFT");
    expect(link.searchParams.get("q")).toBeNull();
  });

  it("compares views order-insensitively and reads defaults", () => {
    expect(sameViewParams("GUESTS_PEOPLE", { status: "waitlist", q: "a" }, { q: "a", status: "waitlist", kind: "all" })).toBe(true);
    expect(sameViewParams("GUESTS_PEOPLE", { status: "waitlist" }, {})).toBe(false);
    expect(viewParam({}, "q")).toBe("");
    expect(viewParam({}, "status")).toBe("all");
  });

  it("validates names: trimmed, 1 to 60 characters, no control characters", () => {
    expect(savedViewNameSchema.parse("  Late arrivals  ")).toBe("Late arrivals");
    expect(savedViewNameSchema.parse("A\u0007B")).toBe("A B");
    expect(savedViewNameSchema.safeParse("   ").success).toBe(false);
    expect(savedViewNameSchema.safeParse("x".repeat(61)).success).toBe(false);
    expect(savedViewNameSchema.safeParse("x".repeat(60)).success).toBe(true);
  });

  it("has presets for every surface that pass their own allow-list", () => {
    for (const surface of SAVED_VIEW_SURFACES) {
      expect(VIEW_PRESETS[surface].length).toBeGreaterThan(0);
      for (const preset of VIEW_PRESETS[surface]) {
        expect(sanitizeViewParams(surface, preset.params)).toEqual(preset.params);
        expect(Object.keys(preset.params).every((key) => key in SURFACE_PARAMS[surface])).toBe(true);
      }
    }
    expect(presetsFor("GUESTS_PEOPLE").map((preset) => preset.label)).toEqual(["Waitlisted", "Checked in", "Not checked in"]);
    expect(presetsFor("GUESTS_PEOPLE", { teamMode: true }).map((preset) => preset.label)).toContain("Solo");
    expect(presetsFor("GUESTS_TEAMS").map((preset) => preset.label)).toEqual(["Incomplete", "Pending approval", "Looking for members"]);
    expect(presetsFor("JUDGING_SUBMISSIONS").map((preset) => preset.label)).toEqual(["Not submitted", "Drafts", "Disqualified"]);
    expect(presetsFor("JUDGING_RESULTS").map((preset) => preset.params)).toEqual([{ scored: "unscored" }, { scored: "underTwo" }]);
    expect(presetsFor("JUDGING_PROGRESS")).toEqual([expect.objectContaining({ label: "Below target", params: { show: "below-target" } })]);
  });
});

describe("filters behind the presets", () => {
  it("People: not checked in is going and not yet at the door", () => {
    expect(attendeeStatusWhere("notCheckedIn")).toEqual({ status: "CONFIRMED", checkedInAt: null });
    expect(parseAttendeeViewSearchParams(new URLSearchParams("status=notCheckedIn"))).toMatchObject({ status: "notCheckedIn" });
  });

  it("Results: unscored and fewer-than-two count SUBMITTED rows only", () => {
    const rows = [
      { status: "SUBMITTED", judgesCounted: 0 },
      { status: "SUBMITTED", judgesCounted: 1 },
      { status: "SUBMITTED", judgesCounted: 2 },
      { status: "DISQUALIFIED", judgesCounted: 0 },
    ];
    expect(countScoreFilters(rows)).toEqual({ all: 4, unscored: 1, underTwo: 2 });
    expect(rows.filter((row) => matchesScoreFilter(row, "underTwo")).map((row) => row.judgesCounted)).toEqual([0, 1]);
    expect(judgingResultsQuerySchema.safeParse({ scored: "unscored" }).success).toBe(true);
    expect(judgingResultsQuerySchema.safeParse({ scored: "everything" }).success).toBe(false);
  });
});
