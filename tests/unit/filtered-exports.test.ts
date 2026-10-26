import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  audit: vi.fn(),
  event: vi.fn(),
  resolve: vi.fn(),
  list: vi.fn(),
  submissions: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.audit }));
vi.mock("@/lib/db", () => ({ prisma: { event: { findUnique: mocks.event }, submission: { findMany: mocks.submissions } } }));
vi.mock("@/lib/core/teams", () => ({
  ORGANISER_TEAMS_EXPORT_BATCH_SIZE: 200,
  listEventTeamsForOrganiser: mocks.list,
  resolveOrganiserEvent: mocks.resolve,
}));

import { csvStreamResponse, exportFilename, exportFilterNames } from "@/lib/csvExport";
import { parseTeamExportSearchParams, teamExportRow, teamExportSearchParams } from "@/lib/teamExport";
import { judgingResultsExportHref, judgingSubmissionsExportHref, parseJudgingExportSearchParams } from "@/lib/judgingExport";
import { ORGANISER_TEAM_FILTERS } from "@/lib/organiserTeamFilters";
import { GET } from "@/app/api/exports/events/[eventId]/teams/route";

const team = (name: string, extra: Partial<Parameters<typeof teamExportRow>[0]> = {}) => ({
  id: `id-${name}`,
  name,
  status: "CONFIRMED" as const,
  size: 2,
  incomplete: false,
  lookingForMembers: false,
  createdAt: new Date("2030-01-02T03:04:05.000Z"),
  members: [
    { name: "Ada", email: "ada@example.test", isLeader: true },
    { name: "Grace", email: null, isLeader: false },
  ],
  ...extra,
});

describe("CSV export helpers", () => {
  it("names files safely and audits filter names only", () => {
    expect(exportFilename("teams", "Hack <Night>!", new Date("2030-01-02T00:00:00Z"))).toBe("teams_Hack_Night_2030-01-02.csv");
    expect(exportFilename("teams", "§§§", new Date("2030-01-02T00:00:00Z"))).toBe("teams_event_2030-01-02.csv");
    expect(exportFilterNames({ status: true, search: true, kind: false })).toBe("status,search");
    expect(exportFilterNames({ status: false })).toBe("none");
  });

  it("streams a BOM, the header and each batch, neutralising formulas", async () => {
    const response = csvStreamResponse({
      header: ["Name"],
      filename: "x.csv",
      errorMessage: "nope",
      batches: async function* () {
        yield [["=1+1"]];
        yield [];
        yield [["+cmd"], ["plain, text"]];
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="x.csv"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    // UTF-8 BOM first, so spreadsheets read the file as UTF-8.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("Name\n'=1+1\n'+cmd\n\"plain, text\"\n");
  });

  it("fails the download instead of sending a short file", async () => {
    const response = csvStreamResponse({
      header: ["Name"],
      filename: "x.csv",
      errorMessage: "nope",
      batches: async function* () {
        yield [["one"]];
        throw new Error("database gone");
      },
    });
    await expect(response.text()).rejects.toThrow();
  });
});

describe("Teams export rows and parameters", () => {
  it("round-trips the Teams view and accepts exactly its filters", () => {
    expect(teamExportSearchParams({ status: "all", query: "  " })).toBe("");
    const query = teamExportSearchParams({ status: "incomplete", query: " Rocket " });
    expect(parseTeamExportSearchParams(new URLSearchParams(query))).toEqual({ status: "incomplete", query: "Rocket" });
    for (const status of ORGANISER_TEAM_FILTERS) expect(parseTeamExportSearchParams(new URLSearchParams({ status }))).not.toBeNull();
    expect(parseTeamExportSearchParams(new URLSearchParams({ status: "checkedIn" }))).toBeNull();
    expect(parseTeamExportSearchParams(new URLSearchParams({ q: "x".repeat(101) }))).toBeNull();
  });

  it("writes the leader, members and submission status", () => {
    expect(teamExportRow(team("Rockets", { incomplete: true, lookingForMembers: true }), "SUBMITTED")).toEqual([
      "Rockets", "CONFIRMED", "2", "Yes", "Yes", "Ada", "ada@example.test", "Ada <ada@example.test>; Grace", "SUBMITTED", "2030-01-02T03:04:05.000Z",
    ]);
    expect(teamExportRow(team("Solo", { members: [] }), null)).toEqual(["Solo", "CONFIRMED", "2", "No", "No", "", "", "", "None", "2030-01-02T03:04:05.000Z"]);
  });
});

describe("Judging export parameters", () => {
  it("builds links from the view showing and parses them back", () => {
    const base = "/api/exports/events/e1/judging";
    expect(judgingResultsExportHref(base, { query: "", method: "RAW" })).toBe(`${base}?method=RAW`);
    const results = judgingResultsExportHref(base, { query: " bot ", method: "ZSCORE", scored: "underTwo" });
    expect(parseJudgingExportSearchParams(new URL(results, "https://x.test").searchParams)).toEqual({ view: "results", query: "bot", status: "all", scored: "underTwo", method: "ZSCORE" });
    expect(judgingSubmissionsExportHref(base, { query: "", status: "all" })).toBe(`${base}?view=submissions`);
    const submissions = judgingSubmissionsExportHref(base, { query: "bot", status: "DRAFT" });
    expect(parseJudgingExportSearchParams(new URL(submissions, "https://x.test").searchParams)).toEqual({ view: "submissions", query: "bot", status: "DRAFT", scored: "all", method: null });
  });

  it("refuses unknown values and another view's filters", () => {
    for (const query of ["view=x", "method=MEAN", "status=SUBMITTED", "view=submissions&method=RAW", "view=submissions&scored=unscored", "view=submissions&status=PENDING"]) {
      expect(parseJudgingExportSearchParams(new URLSearchParams(query))).toBeNull();
    }
    expect(parseJudgingExportSearchParams(new URLSearchParams(""))).toEqual({ view: "results", query: "", status: "all", scored: "all", method: null });
  });
});

describe("Teams CSV export route", () => {
  const ctx = { userId: "user_1", organisationId: "org_1", orgSlug: "club", eventId: "event_1", eventSlug: "hack" };
  const routeContext = { params: Promise.resolve({ eventId: "event_1" }) };
  const request = (query = "") => new Request(`https://events.example.test/api/exports/events/event_1/teams${query ? `?${query}` : ""}`);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
    mocks.event.mockResolvedValue({ id: "event_1", title: "Hack Night", registrationMode: "TEAM", organisation: { slug: "club" } });
    mocks.resolve.mockResolvedValue(ctx);
    mocks.list
      .mockResolvedValueOnce({ teams: [team("=Rockets")], nextCursor: "c1" })
      .mockResolvedValueOnce({ teams: [team("Comets")], nextCursor: null });
    mocks.submissions.mockResolvedValue([{ teamId: "id-Comets", status: "DRAFT" }]);
  });

  it("walks every page of the Teams view's query under the current filters", async () => {
    const response = await GET(request("status=going&q=Ada%20Lovelace"), routeContext);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="teams_Hack_Night_/);
    const lines = (await response.text()).replace(/^﻿/, "").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^'=Rockets,CONFIRMED,.*,None,/);
    expect(lines[2]).toMatch(/^Comets,.*,DRAFT,/);
    expect(mocks.resolve).toHaveBeenCalledWith("user_1", "club", "event_1");
    expect(mocks.list).toHaveBeenNthCalledWith(1, ctx, { query: "Ada Lovelace", filter: "going", cursor: null }, { pageSize: 200 });
    expect(mocks.list).toHaveBeenNthCalledWith(2, ctx, { query: "Ada Lovelace", filter: "going", cursor: "c1" }, { pageSize: 200 });
    expect(mocks.submissions).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: "event_1", teamId: { in: ["id-=Rockets"] } } }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "TEAM_LIST_EXPORTED", organisationId: "org_1", metadata: { surface: "teams", filters: "status,search" } }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain("Ada");
  });

  it("answers denials, non-team events and malformed filters with an empty 404", async () => {
    mocks.resolve.mockResolvedValue(null);
    expect((await GET(request(), routeContext)).status).toBe(404);
    mocks.resolve.mockResolvedValue(ctx);
    mocks.event.mockResolvedValue({ id: "event_1", title: "Talk", registrationMode: "INDIVIDUAL", organisation: { slug: "club" } });
    expect((await GET(request(), routeContext)).status).toBe(404);
    mocks.auth.mockResolvedValue(null);
    expect((await GET(request(), routeContext)).status).toBe(404);
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } });
    const malformed = await GET(request("status=everyone"), routeContext);
    expect(malformed.status).toBe(404);
    expect(await malformed.text()).toBe("");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
