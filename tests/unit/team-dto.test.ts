import { describe, expect, it, vi } from "vitest";
import { RsvpStatus, SoloPolicy, TeamJoinRequestDirection } from "@prisma/client";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/rsvpCore", () => ({ submitRsvpCore: vi.fn() }));
vi.mock("@/lib/core/rsvpCancel", () => ({ cancelRsvpForUser: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ canManageEvents: vi.fn(), getMembership: vi.fn() }));

import { joinPageTeamDto, seekerDisplayName, seekerListDto, teamPageDto } from "@/lib/core/teams";

const FORBIDDEN = /email|token|answer|checkIn(Token)?$|userId|attendeeKey|manage/i;

function keysDeep(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || value instanceof Date) return [];
  return Object.entries(value).flatMap(([key, child]) => [`${prefix}${key}`, ...keysDeep(child, `${prefix}${key}.`)]);
}

describe("join page DTO", () => {
  it("reveals only the team name, size and maximum size", () => {
    const dto = joinPageTeamDto(
      Object.assign({ name: "Byte Me", size: 3 }, { members: ["Ada Lovelace"], joinToken: "secret", manageTokenHash: "hash" }),
      5,
    );
    expect(dto).toEqual({ name: "Byte Me", size: 3, maxSize: 5 });
    expect(Object.keys(dto).sort()).toEqual(["maxSize", "name", "size"]);
  });
});

describe("seeker list DTO", () => {
  it("shows first name and last initial, headline and skills only", () => {
    const rows = [
      {
        id: "profile_1",
        headline: "Backend dev",
        skills: ["Go"],
        rsvpId: "rsvp_1",
        visible: true,
        rsvp: { guestName: null, guestEmail: "ada@example.test", checkInToken: "ticket-secret", user: { name: "Ada King Lovelace", email: "ada@example.test" } },
      },
      { id: "profile_2", headline: "Artist", skills: [], rsvp: { guestName: "grace", user: null } },
    ];
    const dto = seekerListDto(rows as never);
    expect(dto).toEqual([
      { id: "profile_1", displayName: "Ada L.", headline: "Backend dev", skills: ["Go"] },
      { id: "profile_2", displayName: "grace", headline: "Artist", skills: [] },
    ]);
    for (const key of keysDeep(dto)) expect(key).not.toMatch(FORBIDDEN);
    expect(JSON.stringify(dto)).not.toContain("example.test");
    expect(JSON.stringify(dto)).not.toContain("ticket-secret");
  });

  it("never falls back to an email for the display name", () => {
    expect(seekerDisplayName(null)).toBe("Someone");
    expect(seekerDisplayName("  ")).toBe("Someone");
    expect(seekerDisplayName("Émile zola")).toBe("Émile Z.");
    expect(seekerDisplayName("<b>Bob</b> Smith")).not.toMatch(/[<>]/);
  });
});

describe("team page DTO", () => {
  it("lists member names without emails, answers or ticket tokens", () => {
    const row = {
      id: "team_1",
      name: "Byte Me",
      status: RsvpStatus.CONFIRMED,
      joinToken: "j".repeat(43),
      leaderRsvpId: "rsvp_1",
      lookingForMembers: true,
      manageTokenHash: "f".repeat(64),
      event: {
        title: "Jam",
        slug: "jam",
        startDateTime: new Date("2035-01-01T10:00:00Z"),
        endDateTime: new Date("2035-01-02T10:00:00Z"),
        timezone: "UTC",
        teamMinSize: 3,
        teamMaxSize: 5,
        soloPolicy: SoloPolicy.SOLO_WITH_MATCHING,
        registrationOpen: true,
        organisation: { slug: "org" },
      },
      members: [
        { id: "rsvp_1", guestName: null, guestEmail: "lead@example.test", checkInToken: "ticket-1", checkedInAt: null, user: { name: "Lead Person", email: "lead@example.test" } },
        { id: "rsvp_2", guestName: "Member Two", guestEmail: "two@example.test", checkInToken: "ticket-2", checkedInAt: new Date(), user: null },
      ],
      joinRequests: [
        { id: "req_1", direction: TeamJoinRequestDirection.REQUEST, rsvp: { guestName: "Seek Er", guestEmail: "s@example.test", user: null, seekerProfile: { headline: "UI", skills: ["CSS"] } } },
      ],
    };
    const dto = teamPageDto(row as never);
    expect(dto.team).toMatchObject({ size: 2, minSize: 3, maxSize: 5, incomplete: true, joinPath: `/org/jam/team/${"j".repeat(43)}` });
    expect(dto.members).toEqual([
      { rsvpId: "rsvp_1", name: "Lead Person", isLeader: true, checkedIn: false },
      { rsvpId: "rsvp_2", name: "Member Two", isLeader: false, checkedIn: true },
    ]);
    expect(dto.pendingRequests).toEqual([{ id: "req_1", direction: "REQUEST", displayName: "Seek E.", headline: "UI", skills: ["CSS"] }]);
    const serialised = JSON.stringify(dto);
    expect(serialised).not.toContain("example.test");
    expect(serialised).not.toContain("ticket-");
    expect(serialised).not.toContain("f".repeat(64));
    for (const key of keysDeep(dto)) expect(key).not.toMatch(FORBIDDEN);
  });
});
