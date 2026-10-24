import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/rsvpCore", () => ({ submitRsvpCore: vi.fn() }));
vi.mock("@/lib/core/rsvpCancel", () => ({ cancelRsvpForUser: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ canManageEvents: vi.fn(), getMembership: vi.fn() }));

import {
  decodeTeamCursor,
  encodeTeamCursor,
  escapeLikePattern,
  organiserTeamsQuerySchema,
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
