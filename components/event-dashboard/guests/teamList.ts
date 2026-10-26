import type { RsvpStatus } from "@prisma/client";
import type { GuestStatusFilter } from "./guestList";

/*
 * Pure helpers for the event dashboard's Guests · Teams list (docs/TEAMS.md):
 * status filters and counts, search, size copy, and which teams a member can
 * be moved into. No React, no I/O.
 */

export type TeamLike = {
  id: string;
  name: string;
  status: RsvpStatus;
  size: number;
  minSize: number | null;
  maxSize: number | null;
  incomplete: boolean;
  /** Listed as looking for members (team matching). */
  lookingForMembers?: boolean;
  members: Array<{ name: string; email: string | null; checkedIn: boolean }>;
};

export type TeamStatusFilter = Exclude<GuestStatusFilter, "checkedIn" | "notCheckedIn"> | "incomplete" | "looking";

export const TEAM_FILTERS: Array<{ value: TeamStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "going", label: "Going" },
  { value: "waitlist", label: "Waitlist" },
  { value: "approve", label: "To approve" },
  { value: "declined", label: "Declined" },
  { value: "incomplete", label: "Incomplete" },
  { value: "looking", label: "Looking for members" },
];

export function matchesTeamStatus(team: TeamLike, filter: TeamStatusFilter) {
  switch (filter) {
    case "all":
      return true;
    case "going":
      return team.status === "CONFIRMED";
    case "waitlist":
      return team.status === "WAITLISTED";
    case "approve":
      return team.status === "PENDING_APPROVAL";
    case "declined":
      return team.status === "REJECTED";
    case "incomplete":
      return team.incomplete;
    case "looking":
      return team.lookingForMembers === true;
  }
}

export function countTeamFilters(teams: TeamLike[]): Record<TeamStatusFilter, number> {
  const counts = Object.fromEntries(TEAM_FILTERS.map(({ value }) => [value, 0])) as Record<TeamStatusFilter, number>;
  for (const team of teams) {
    for (const { value } of TEAM_FILTERS) if (matchesTeamStatus(team, value)) counts[value] += 1;
  }
  return counts;
}

/** Search by team name, or by a member's name or email. */
export function filterTeams<T extends TeamLike>(teams: T[], options: { status?: TeamStatusFilter; query?: string }): T[] {
  const { status = "all", query = "" } = options;
  const q = query.trim().toLowerCase();
  return teams.filter((team) => {
    if (!matchesTeamStatus(team, status)) return false;
    if (!q) return true;
    if (team.name.toLowerCase().includes(q)) return true;
    return team.members.some((member) => member.name.toLowerCase().includes(q) || (member.email ?? "").toLowerCase().includes(q));
  });
}

/** "3 people · 2 to 5", "1 person · up to 4". */
export function teamSizeLabel(team: Pick<TeamLike, "size" | "minSize" | "maxSize">) {
  const people = `${team.size} ${team.size === 1 ? "person" : "people"}`;
  if (team.maxSize == null) return people;
  if (team.minSize != null && team.minSize > 1) return `${people} · ${team.minSize === team.maxSize ? `exactly ${team.maxSize}` : `${team.minSize} to ${team.maxSize}`}`;
  return `${people} · up to ${team.maxSize}`;
}

/** "2 of 3 checked in", or null when nobody has arrived. */
export function teamCheckInLabel(team: Pick<TeamLike, "members">) {
  const checkedIn = team.members.filter((member) => member.checkedIn).length;
  return checkedIn ? `${checkedIn} of ${team.members.length} checked in` : null;
}

/**
 * Teams a registration can be moved into: another team of the same event
 * that is not declined and has room. The server rechecks all of this under
 * the event lock; this only keeps impossible choices out of the list.
 */
export function moveTargets<T extends Pick<TeamLike, "id" | "status" | "size" | "maxSize">>(teams: T[], currentTeamId: string | null): T[] {
  return teams.filter((team) => team.id !== currentTeamId && team.status !== "REJECTED" && (team.maxSize == null || team.size < team.maxSize));
}

/** What moving into a team does to the person's place, in plain words. */
export function moveOutcome(targetStatus: RsvpStatus) {
  switch (targetStatus) {
    case "CONFIRMED":
      return "They will have a place, as the team does.";
    case "WAITLISTED":
      return "They will be on the waitlist with the team.";
    case "PENDING_APPROVAL":
      return "They will wait for approval with the team.";
    case "REJECTED":
      return "Declined teams can't take new members.";
  }
}
