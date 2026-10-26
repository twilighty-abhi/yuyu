import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/rsvpCore", () => ({ submitRsvpCore: vi.fn() }));
vi.mock("@/lib/core/rsvpCancel", () => ({ cancelRsvpForUser: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ canManageEvents: vi.fn(), getMembership: vi.fn() }));

import { Prisma } from "@prisma/client";
import {
  decodeKeysetCursor,
  decodeTeamCursor,
  encodeKeysetCursor,
  encodeTeamCursor,
  escapeLikePattern,
  joinRequestPageQuerySchema,
  matchingListQuerySchema,
  organiserTeamsQuerySchema,
  seekerListConditions,
} from "@/lib/core/teams";

describe("organiser Teams view paging", () => {
  it("round-trips the keyset cursor and refuses malformed ones", () => {
    const team = { createdAt: new Date("2035-01-01T10:00:00.123Z"), id: "cmteam_123-abc" };
    const cursor = encodeTeamCursor(team);
    expect(decodeTeamCursor(cursor)).toEqual(team);
    for (const bad of ["", "abc", "123", ".id", "12.", "12.id;drop", "1e3.id", `${"9".repeat(16)}.id`]) {
      expect(decodeTeamCursor(bad), bad).toBeNull();
    }
  });

  it("escapes LIKE wildcards so a search matches them literally", () => {
    expect(escapeLikePattern("100%_team\\x")).toBe("100\\%\\_team\\\\x");
    expect(escapeLikePattern("plain")).toBe("plain");
  });

  it("bounds the query input", () => {
    expect(organiserTeamsQuerySchema.parse({})).toEqual({ query: "", filter: "all" });
    expect(organiserTeamsQuerySchema.safeParse({ query: "x".repeat(101) }).success).toBe(false);
    expect(organiserTeamsQuerySchema.safeParse({ filter: "everything" }).success).toBe(false);
    expect(organiserTeamsQuerySchema.safeParse({ query: "a", teamId: "x" }).success).toBe(false);
  });
});

describe("attendee matching lists paging", () => {
  it("shares one keyset cursor shape for every list", () => {
    const at = new Date("2035-02-03T04:05:06.789Z");
    expect(decodeKeysetCursor(encodeKeysetCursor(at, "cmseeker_1"))).toEqual({ at, id: "cmseeker_1" });
    expect(encodeKeysetCursor(at, "x")).toBe(encodeTeamCursor({ createdAt: at, id: "x" }));
    for (const bad of ["", "abc", "1.", ".id", "12.id with space", "12.id'--"]) expect(decodeKeysetCursor(bad), bad).toBeNull();
  });

  it("bounds the search and cursor input and refuses unknown keys", () => {
    expect(matchingListQuerySchema.parse({})).toEqual({ query: "" });
    expect(matchingListQuerySchema.parse({ query: "  react ", cursor: null })).toEqual({ query: "react", cursor: null });
    expect(matchingListQuerySchema.safeParse({ query: "x".repeat(101) }).success).toBe(false);
    expect(matchingListQuerySchema.safeParse({ cursor: "x".repeat(161) }).success).toBe(false);
    expect(matchingListQuerySchema.safeParse({ eventId: "other" }).success).toBe(false);
    expect(joinRequestPageQuerySchema.safeParse({ cursor: "1.a" }).success).toBe(true);
    expect(joinRequestPageQuerySchema.safeParse({ teamId: "other" }).success).toBe(false);
  });

  it("scopes seekers to one event and searches headline, skills and first name, never emails", () => {
    const sql = Prisma.join(seekerListConditions({ eventId: "evt_1", pendingWithTeamId: "team_1" }, "50%_go"), " AND ");
    expect(sql.values).toContain("evt_1");
    expect(sql.values).toContain("team_1");
    expect(sql.values).toContain("%50\\%\\_go%");
    expect(sql.sql).toContain(`r."teamId" IS NULL`);
    expect(sql.sql).toContain(`s."visible" = true`);
    expect(sql.sql).toContain("unnest(s.\"skills\")");
    // First name only: the list shows "Ada L.", so a surname must not be searchable.
    expect(sql.sql).toMatch(/regexp_split_to_array\(.*\)\)\[1\] ILIKE/);
    expect(sql.sql).not.toMatch(/email/i);

    const plain = Prisma.join(seekerListConditions({ eventId: "evt_1", excludeRsvpId: "rsvp_me" }, ""), " AND ");
    expect(plain.values).toEqual(["evt_1", "REJECTED", "rsvp_me"]);
    expect(plain.sql).not.toContain("ILIKE");
  });
});
