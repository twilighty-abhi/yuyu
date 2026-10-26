import { describe, expect, it } from "vitest";
import { capacityUnitLabel, publishingSummary, SOLO_POLICY_OPTIONS, teamSizeProblem, teamSizeSummary } from "@/components/event/publishing";
import { filterGuests, isManagedByTeam, type GuestLike } from "@/components/event-dashboard/guests/guestList";
import { countTeamFilters, filterTeams, moveTargets, teamCheckInLabel, teamSizeLabel, type TeamLike } from "@/components/event-dashboard/guests/teamList";
import { printableFields, withMergeFields, type IdCardAttendee } from "@/components/checkin/id-card/shared";
import { applyIdCardMergeFields, defaultIdCardPrintSettings, ID_CARD_TEAM_FIELD_KEY } from "@/lib/idCardPrint";
import { calculateReportTeamMetrics } from "@/lib/eventReport";
import { buildAccountDataExport, type AccountExportSource } from "@/lib/accountDataExport";

describe("team settings in Publishing", () => {
  it("labels capacity in units and sums up a team event", () => {
    expect(capacityUnitLabel(true)).toBe("teams and solo registrants");
    expect(capacityUnitLabel(false)).toBe("spots");
    expect(publishingSummary({ status: "PUBLISHED", privacyType: "PUBLIC", capacity: 30, closing: "open until it ends", teamMode: true }).detail).toBe(
      "Listed publicly, anyone can sign up · 30 places for teams and solo registrants · team registration · open until it ends.",
    );
  });

  it("offers the three solo policies in plain words", () => {
    expect(SOLO_POLICY_OPTIONS.map((option) => option.value)).toEqual(["SOLO_ALLOWED", "SOLO_WITH_MATCHING", "TEAMS_ONLY"]);
    expect(SOLO_POLICY_OPTIONS.every((option) => !/_/.test(option.label))).toBe(true);
  });

  it("checks team sizes the way the server does", () => {
    expect(teamSizeProblem({ minSize: "", maxSize: "" })).toMatch(/maximum/);
    expect(teamSizeProblem({ minSize: "", maxSize: "1" })).toMatch(/at least 2/);
    expect(teamSizeProblem({ minSize: "5", maxSize: "4" })).toMatch(/above the maximum/);
    expect(teamSizeProblem({ minSize: "2", maxSize: "4", largestTeam: 5 })).toMatch(/largest team/);
    expect(teamSizeProblem({ minSize: "", maxSize: "4" })).toBeNull();
    expect(teamSizeSummary(2, 5)).toBe("Teams of 2 to 5 people");
    expect(teamSizeSummary(null, 4)).toBe("Teams of up to 4 people");
    expect(teamSizeSummary(3, 3)).toBe("Teams of exactly 3 people");
  });
});

describe("Guests on a team event", () => {
  const guest = (overrides: Partial<GuestLike>): GuestLike => ({
    status: "CONFIRMED",
    createdAt: "2026-10-14T10:00:00.000Z",
    checkedInAt: null,
    guestEmail: "guest@example.org",
    guestName: "Guest",
    user: null,
    ...overrides,
  });
  const guests = [
    guest({ guestName: "Asha", team: { name: "Night Owls" } }),
    guest({ guestName: "Ravi", team: null }),
    guest({ guestName: "Divya", status: "PENDING_APPROVAL", team: { name: "Byte Club" } }),
  ];

  it("filters In a team / Solo and searches team names", () => {
    expect(filterGuests(guests, { team: "team" }).map((g) => g.guestName)).toEqual(["Asha", "Divya"]);
    expect(filterGuests(guests, { team: "solo" }).map((g) => g.guestName)).toEqual(["Ravi"]);
    expect(filterGuests(guests, { query: "byte" }).map((g) => g.guestName)).toEqual(["Divya"]);
  });

  it("routes team members' status changes to the team", () => {
    expect(isManagedByTeam(guests[2]!)).toBe(true);
    expect(isManagedByTeam(guests[1]!)).toBe(false);
  });
});

describe("Teams view helpers", () => {
  const team = (overrides: Partial<TeamLike>): TeamLike => ({
    id: "t1",
    name: "Night Owls",
    status: "CONFIRMED",
    size: 3,
    minSize: 2,
    maxSize: 4,
    incomplete: false,
    members: [{ name: "Asha", email: "asha@example.org", checkedIn: true }, { name: "Ravi", email: null, checkedIn: false }, { name: "Divya", email: null, checkedIn: false }],
    ...overrides,
  });
  const teams = [
    team({}),
    team({ id: "t2", name: "Byte Club", status: "PENDING_APPROVAL", size: 1, incomplete: true, members: [{ name: "Kiran", email: "kiran@example.org", checkedIn: false }] }),
    team({ id: "t3", name: "Full House", status: "WAITLISTED", size: 4, lookingForMembers: true }),
    team({ id: "t4", name: "Nope", status: "REJECTED", size: 2 }),
  ];

  it("counts and filters by status, incomplete, and member search", () => {
    expect(countTeamFilters(teams)).toMatchObject({ all: 4, going: 1, approve: 1, waitlist: 1, declined: 1, incomplete: 1 });
    expect(filterTeams(teams, { query: "kiran" }).map((t) => t.id)).toEqual(["t2"]);
    expect(filterTeams(teams, { status: "incomplete" }).map((t) => t.id)).toEqual(["t2"]);
    expect(countTeamFilters(teams).looking).toBe(1);
    expect(filterTeams(teams, { status: "looking" }).map((t) => t.id)).toEqual(["t3"]);
  });

  it("describes size and check-in", () => {
    expect(teamSizeLabel(teams[0]!)).toBe("3 people · 2 to 4");
    expect(teamSizeLabel({ size: 1, minSize: null, maxSize: 4 })).toBe("1 person · up to 4");
    expect(teamCheckInLabel(teams[0]!)).toBe("1 of 3 checked in");
    expect(teamCheckInLabel(teams[1]!)).toBeNull();
  });

  it("only offers other, non-declined teams with room as move targets", () => {
    expect(moveTargets(teams, "t1").map((t) => t.id)).toEqual(["t2"]);
    expect(moveTargets(teams, null).map((t) => t.id)).toEqual(["t1", "t2"]);
  });
});

describe("badge {{team}} merge field", () => {
  const attendee = (teamName: string | null): IdCardAttendee => ({
    displayName: "Asha",
    email: null,
    checkInQrToken: "preview",
    checkInDetails: [],
    registrationDetails: [{ key: "company", label: "Company", value: "Acme" }],
    teamName,
  });

  it("fills {{team}} and leaves other text untouched", () => {
    expect(applyIdCardMergeFields("Team {{team}}", { team: "Night Owls" })).toBe("Team Night Owls");
    expect(applyIdCardMergeFields("{{ TEAM }} · Hack Day", { team: "Byte Club" })).toBe("Byte Club · Hack Day");
    expect(applyIdCardMergeFields("Hack  Day", { team: "Byte Club" })).toBe("Hack  Day");
    expect(applyIdCardMergeFields("Team {{team}}", { team: null })).toBe("Team");
  });

  it("applies to heading, label and footer, and prints the Team line only when there is one", () => {
    const settings = { ...defaultIdCardPrintSettings("Hack Day"), heading: "{{team}}", footerText: "Hack Day · {{team}}", printFieldKeys: [ID_CARD_TEAM_FIELD_KEY, "registration:company"] };
    const merged = withMergeFields(settings, attendee("Night Owls"));
    expect(merged.heading).toBe("Night Owls");
    expect(merged.footerText).toBe("Hack Day · Night Owls");
    expect(merged.elementPositions).toBe(settings.elementPositions);
    expect(printableFields(settings, attendee("Night Owls"))).toEqual([
      { key: ID_CARD_TEAM_FIELD_KEY, label: "Team", value: "Night Owls" },
      { key: "registration:company", label: "Company", value: "Acme" },
    ]);
    expect(printableFields(settings, attendee(null)).map((field) => field.key)).toEqual(["registration:company"]);
  });
});

describe("team counts in reports and exports", () => {
  it("counts teams, solo registrants and average size, skipping rejected registrations", () => {
    expect(calculateReportTeamMetrics([
      { status: "CONFIRMED", teamId: "a" },
      { status: "CONFIRMED", teamId: "a" },
      { status: "WAITLISTED", teamId: "b" },
      { status: "CONFIRMED", teamId: null },
      { status: "PENDING_APPROVAL", teamId: null },
      { status: "REJECTED", teamId: "c" },
    ])).toEqual({ teams: 2, confirmedTeams: 1, soloRegistrants: 2, confirmedSoloRegistrants: 1, averageTeamSize: 1.5 });
    expect(calculateReportTeamMetrics([])).toMatchObject({ teams: 0, averageTeamSize: 0 });
  });

  it("includes the team name and role in the personal export, never the RSVP id", () => {
    const event = { title: "Hack Day", startDateTime: new Date("2030-03-01T09:00:00Z"), endDateTime: new Date("2030-03-01T17:00:00Z"), timezone: "UTC", organisation: { name: "Org" } };
    const registration = (id: string, team: { name: string; leaderRsvpId: string | null } | null) => ({
      id,
      status: "CONFIRMED" as const,
      createdAt: new Date("2030-02-01T00:00:00Z"),
      checkedInAt: null,
      event,
      eventInstance: null,
      answers: [],
      team,
    });
    const source: AccountExportSource = {
      user: { name: "Ada", email: "ada@example.test", emailVerified: null, createdAt: new Date("2030-01-01T00:00:00Z"), mfaEnabledAt: null },
      signInProviders: [],
      memberships: [],
      registrations: [
        registration("rsvp_leader", { name: "Night Owls", leaderRsvpId: "rsvp_leader" }),
        registration("rsvp_member", { name: "Byte Club", leaderRsvpId: "someone_else" }),
        registration("rsvp_solo", null),
      ],
      feedback: [],
      collaborations: [],
    };
    const data = buildAccountDataExport(source);
    expect(data.registrations.map((r) => [r.team, r.teamRole])).toEqual([["Night Owls", "leader"], ["Byte Club", "member"], [null, null]]);
    expect(JSON.stringify(data)).not.toContain("rsvp_leader");
  });
});
