/**
 * Wording for capacity on TEAM events (docs/TEAMS.md). Capacity there counts
 * registration units (each confirmed team once, plus each confirmed solo
 * registrant), so organiser screens show units against capacity and the
 * number of people separately. INDIVIDUAL events keep their existing wording.
 * Pure helpers: safe on the server and in client components.
 */

type SoloPolicyValue = "SOLO_ALLOWED" | "TEAMS_ONLY";

/** "teams & solo places" (or "teams" when solo registration is off), singular for 1. */
export function teamUnitNoun(soloPolicy: SoloPolicyValue | string, count: number): string {
  const teamsOnly = soloPolicy === "TEAMS_ONLY";
  if (count === 1) return teamsOnly ? "team" : "team or solo place";
  return teamsOnly ? "teams" : "teams & solo places";
}

/** Short noun for tight spots such as list chips: "teams" or "places". */
export function teamUnitShortNoun(soloPolicy: SoloPolicyValue | string): string {
  return soloPolicy === "TEAMS_ONLY" ? "teams" : "places";
}

/** "3 / 3 teams & solo places", or "3 teams & solo places" without a limit. */
export function teamCapacityLabel(units: number, capacity: number | null, soloPolicy: SoloPolicyValue | string): string {
  if (capacity != null) return `${units} / ${capacity} ${teamUnitNoun(soloPolicy, capacity)}`;
  return `${units} ${teamUnitNoun(soloPolicy, units)}`;
}

/** "1 person", "6 people". */
export function peopleCount(count: number): string {
  return `${count} ${count === 1 ? "person" : "people"}`;
}
