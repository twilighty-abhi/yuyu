import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { decodeKeyCursor, decodeTimeCursor, encodeKeyCursor, encodeTimeCursor, showingLabel } from "@/lib/keysetCursor";
import {
  attendeeBaseWhere,
  attendeeCursorWhere,
  attendeeScopeWhere,
  attendeeStatusWhere,
  attendeeViewSearchParams,
  attendeeListViewSchema,
  containsText,
  parseAttendeeViewSearchParams,
} from "@/lib/attendeeListQuery";
import { appendRecentPage, compareRecent, mergeRecentFirstPage } from "@/lib/checkInRecentMerge";
import { clampPage } from "@/lib/eventDashboard/invites";

describe("keyset cursors", () => {
  it("round-trips a time cursor and rejects malformed ones", () => {
    const at = new Date("2026-10-25T10:11:12.345Z");
    const cursor = encodeTimeCursor({ at, id: "cmv123abc" });
    expect(cursor).toBe(`${at.getTime()}.cmv123abc`);
    expect(decodeTimeCursor(cursor)).toEqual({ at, id: "cmv123abc" });
    for (const bad of ["", "abc", "123", "123.", ".id", "123.id with space", "1.2.3", `${"9".repeat(16)}.id`, "123.' OR 1=1 --"]) {
      expect(decodeTimeCursor(bad)).toBeNull();
    }
    expect(decodeTimeCursor(null)).toBeNull();
  });

  it("round-trips a text key cursor, including non-ASCII names", () => {
    for (const key of ["alpha team", "équipe ñ 東京", "100% _done_ \\ \"quoted\"", ""]) {
      const cursor = encodeKeyCursor({ key, id: "team_1" });
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeKeyCursor(cursor)).toEqual({ key, id: "team_1" });
    }
  });

  it("rejects tampered or oversized key cursors", () => {
    expect(decodeKeyCursor("not base64!")).toBeNull();
    expect(decodeKeyCursor(btoa(JSON.stringify({ key: "a", id: "b" })))).toBeNull();
    expect(decodeKeyCursor(encodeKeyCursor({ key: "a", id: "bad id" }))).toBeNull();
    expect(decodeKeyCursor(encodeKeyCursor({ key: "x".repeat(300), id: "t1" }))).toBeNull();
    expect(decodeKeyCursor("a".repeat(700))).toBeNull();
  });

  it("words a loaded slice of a counted list", () => {
    expect(showingLabel(50, 909, "guests")).toBe("Showing 50 of 909 guests");
    expect(showingLabel(60, 50, "guests")).toBe("Showing 50 of 50 guests");
  });
});

describe("Guests · People query", () => {
  const event = { kind: "event" as const, eventId: "event_1", organisationId: "org_1" };
  const instance = { kind: "instance" as const, eventInstanceId: "inst_1", organisationId: "org_1" };
  const view = (patch: Partial<{ query: string; kind: "all" | "guests" | "users"; team: "all" | "team" | "solo" }> = {}) => ({ query: "", kind: "all" as const, team: "all" as const, ...patch });

  it("always scopes to the event or occurrence inside the organisation", () => {
    expect(attendeeScopeWhere(event)).toEqual({ eventId: "event_1", event: { organisationId: "org_1" } });
    expect(attendeeScopeWhere(instance)).toEqual({ eventInstanceId: "inst_1", eventInstance: { series: { organisationId: "org_1" } } });
    expect(attendeeBaseWhere(event, view(), { teamMode: false })).toEqual({ AND: [attendeeScopeWhere(event)] });
  });

  it("maps the guest-kind and team filters to conditions", () => {
    expect(attendeeBaseWhere(event, view({ kind: "guests" }), { teamMode: false }).AND).toContainEqual({ userId: null });
    expect(attendeeBaseWhere(event, view({ kind: "users" }), { teamMode: false }).AND).toContainEqual({ userId: { not: null } });
    expect(attendeeBaseWhere(event, view({ team: "team" }), { teamMode: true }).AND).toContainEqual({ teamId: { not: null } });
    expect(attendeeBaseWhere(event, view({ team: "solo" }), { teamMode: true }).AND).toContainEqual({ teamId: null });
    // The team filter only exists on TEAM events.
    expect(attendeeBaseWhere(event, view({ team: "solo" }), { teamMode: false }).AND).toHaveLength(1);
  });

  it("searches names and emails, and team names inside this event on TEAM events", () => {
    const and = attendeeBaseWhere(event, view({ query: "  ada " }), { teamMode: true }).AND as Array<{ OR?: unknown[] }>;
    const search = and.find((condition) => condition.OR)!.OR!;
    const contains = { contains: "ada", mode: "insensitive" };
    expect(search).toEqual([
      { guestName: contains },
      { guestEmail: contains },
      { user: { name: contains } },
      { user: { email: contains } },
      { team: { eventId: "event_1", name: contains } },
    ]);
    const plain = attendeeBaseWhere(event, view({ query: "ada" }), { teamMode: false }).AND as Array<{ OR?: unknown[] }>;
    expect(plain.find((condition) => condition.OR)!.OR).toHaveLength(4);
  });

  it("matches LIKE wildcards literally", () => {
    expect(containsText("100%_a\\b")).toEqual({ contains: "100\\%\\_a\\\\b", mode: "insensitive" });
  });

  it("maps each status chip", () => {
    expect(attendeeStatusWhere("all")).toEqual({});
    expect(attendeeStatusWhere("going")).toEqual({ status: "CONFIRMED" });
    expect(attendeeStatusWhere("waitlist")).toEqual({ status: "WAITLISTED" });
    expect(attendeeStatusWhere("approve")).toEqual({ status: "PENDING_APPROVAL" });
    expect(attendeeStatusWhere("declined")).toEqual({ status: "REJECTED" });
    expect(attendeeStatusWhere("checkedIn")).toEqual({ checkedInAt: { not: null } });
  });

  it("pages strictly after the cursor on (createdAt desc, id desc)", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(attendeeCursorWhere(null)).toEqual({});
    expect(attendeeCursorWhere(encodeTimeCursor({ at, id: "r9" }))).toEqual({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "r9" } }] });
    expect(attendeeCursorWhere("garbage")).toBeNull();
  });

  it("validates views strictly", () => {
    expect(attendeeListViewSchema.safeParse({ status: "everyone" }).success).toBe(false);
    expect(attendeeListViewSchema.safeParse({ eventId: "other" }).success).toBe(false);
    expect(attendeeListViewSchema.safeParse({ query: "x".repeat(101) }).success).toBe(false);
    expect(attendeeListViewSchema.safeParse({ attendance: "maybe" }).success).toBe(false);
    expect(attendeeListViewSchema.parse({})).toEqual({ query: "", status: "all", kind: "all", team: "all", attendance: "all" });
  });

  it("carries the view into the email export link and back", () => {
    const full = { query: " ada ", status: "going" as const, kind: "guests" as const, team: "solo" as const };
    const qs = attendeeViewSearchParams(full);
    expect(qs).toBe("status=going&kind=guests&team=solo&q=ada");
    expect(parseAttendeeViewSearchParams(new URLSearchParams(qs))).toEqual({ query: "ada", status: "going", kind: "guests", team: "solo", attendance: "all", cursor: null });
    const replied = attendeeViewSearchParams({ ...full, attendance: "noReply" });
    expect(replied).toBe("status=going&kind=guests&team=solo&attendance=noReply&q=ada");
    expect(parseAttendeeViewSearchParams(new URLSearchParams(replied))?.attendance).toBe("noReply");
    expect(parseAttendeeViewSearchParams(new URLSearchParams("attendance=maybe"))).toBeNull();
    expect(attendeeViewSearchParams({ query: "", status: "all", kind: "all", team: "all" })).toBe("");
    expect(parseAttendeeViewSearchParams(new URLSearchParams("status=bogus"))).toBeNull();
  });
});

describe("Recent check-ins list", () => {
  const row = (id: string, minute: number) => ({ rsvpId: id, checkedInAt: `2026-10-25T10:${String(minute).padStart(2, "0")}:00.000Z` });

  it("orders newest first, then by id", () => {
    expect(compareRecent(row("a", 2), row("b", 1))).toBe(-1);
    expect(compareRecent(row("a", 1), row("b", 1))).toBe(1);
    expect(compareRecent(row("a", 1), row("a", 1))).toBe(0);
  });

  it("keeps older loaded pages under a refreshed first page", () => {
    // Showing 4 (two pages of 2): d c | b a. One new check-in (e) arrives.
    const previous = { rows: [row("d", 4), row("c", 3), row("b", 2), row("a", 1)], cursor: null };
    const merged = mergeRecentFirstPage(previous, { rows: [row("e", 5), row("d", 4)], nextCursor: "next" });
    expect(merged.rows.map((r) => r.rsvpId)).toEqual(["e", "d", "c", "b", "a"]);
    expect(merged.cursor).toBeNull();
  });

  it("restarts from the first page when the pages would not join up", () => {
    const previous = { rows: [row("b", 2), row("a", 1), row("z", 0)], cursor: "older" };
    const fresh = { rows: [row("e", 9), row("d", 8)], nextCursor: "next" };
    expect(mergeRecentFirstPage(previous, fresh)).toEqual({ rows: fresh.rows, cursor: "next" });
  });

  it("takes the first page as is when nothing more had been loaded", () => {
    const previous = { rows: [row("b", 2), row("a", 1)], cursor: "c1" };
    const fresh = { rows: [row("c", 3), row("b", 2)], nextCursor: "c2" };
    expect(mergeRecentFirstPage(previous, fresh)).toEqual({ rows: fresh.rows, cursor: "c2" });
  });

  it("drops an undone row that falls inside the refreshed first page", () => {
    const previous = { rows: [row("d", 4), row("c", 3), row("b", 2), row("a", 1)], cursor: null };
    // c was undone elsewhere; the first page now reaches down to b.
    const merged = mergeRecentFirstPage(previous, { rows: [row("d", 4), row("b", 2)], nextCursor: "n" });
    expect(merged.rows.map((r) => r.rsvpId)).toEqual(["d", "b", "a"]);
  });

  it("appends a page without repeating rows", () => {
    const appended = appendRecentPage({ rows: [row("b", 2)], cursor: "x" }, { rows: [row("b", 2), row("a", 1)], nextCursor: null });
    expect(appended).toEqual({ rows: [row("b", 2), row("a", 1)], cursor: null });
  });
});

describe("numbered invite pages", () => {
  it("clamps a requested page to the pages that exist", () => {
    expect(clampPage(1, 0, 50)).toEqual({ page: 1, pageCount: 1 });
    expect(clampPage(3, 120, 50)).toEqual({ page: 3, pageCount: 3 });
    expect(clampPage(9, 120, 50)).toEqual({ page: 3, pageCount: 3 });
    expect(clampPage(0, 120, 50)).toEqual({ page: 1, pageCount: 3 });
    expect(clampPage(2, 100, 50)).toEqual({ page: 2, pageCount: 2 });
  });
});
