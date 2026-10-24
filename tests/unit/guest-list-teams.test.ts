import { describe, expect, it } from "vitest";
import {
  filterGuests,
  isManagedByTeam,
  matchesTeamFilter,
  type GuestLike,
} from "@/components/event-dashboard/guests/guestList";

const guest = (overrides: Partial<GuestLike>): GuestLike => ({
  status: "CONFIRMED",
  createdAt: "2026-10-14T10:00:00.000Z",
  checkedInAt: null,
  guestEmail: "guest@example.org",
  guestName: "Asha Shetty",
  user: null,
  ...overrides,
});

const guests: GuestLike[] = [
  guest({ guestName: "Asha Shetty", guestEmail: "asha@example.org", team: { name: "Pixel Pirates" } }),
  guest({ guestName: "Ravi Kumar", guestEmail: "ravi@example.org", team: { name: "Pixel Pirates" } }),
  guest({ status: "WAITLISTED", guestName: "Divya V.", guestEmail: "divya@example.org", team: { name: "Late Night Coders" } }),
  guest({ guestName: "Jo Thomas", guestEmail: "jo@example.org", team: null }),
  // INDIVIDUAL events never set `team`; such rows count as solo.
  guest({ status: "WAITLISTED", guestName: "Kiran Reddy", guestEmail: "kiran@example.org" }),
];

const names = (rows: GuestLike[]) => rows.map((row) => row.guestName);

describe("guest list team filters", () => {
  it("splits registrations into team members and solo registrants", () => {
    expect(names(filterGuests(guests, { team: "team" }))).toEqual(["Asha Shetty", "Ravi Kumar", "Divya V."]);
    expect(names(filterGuests(guests, { team: "solo" }))).toEqual(["Jo Thomas", "Kiran Reddy"]);
    expect(filterGuests(guests, { team: "all" })).toHaveLength(guests.length);
    expect(filterGuests(guests, {})).toHaveLength(guests.length);
  });

  it("combines the team filter with status filters", () => {
    expect(names(filterGuests(guests, { team: "team", status: "waitlist" }))).toEqual(["Divya V."]);
    expect(names(filterGuests(guests, { team: "solo", status: "going" }))).toEqual(["Jo Thomas"]);
  });

  it("searches by team name as well as name and email", () => {
    expect(names(filterGuests(guests, { query: "pixel" }))).toEqual(["Asha Shetty", "Ravi Kumar"]);
    expect(names(filterGuests(guests, { query: "  LATE night " }))).toEqual(["Divya V."]);
    expect(names(filterGuests(guests, { query: "pirates", team: "solo" }))).toEqual([]);
  });

  it("treats a missing or null team as solo", () => {
    expect(matchesTeamFilter(guest({}), "solo")).toBe(true);
    expect(matchesTeamFilter(guest({ team: null }), "team")).toBe(false);
    expect(matchesTeamFilter(guest({ team: { name: "A" } }), "team")).toBe(true);
    expect(matchesTeamFilter(guest({ team: { name: "A" } }), "all")).toBe(true);
  });

  it("marks team members as managed through their team", () => {
    expect(isManagedByTeam(guest({ team: { name: "A" } }))).toBe(true);
    expect(isManagedByTeam(guest({ team: null }))).toBe(false);
    expect(isManagedByTeam(guest({}))).toBe(false);
  });
});
