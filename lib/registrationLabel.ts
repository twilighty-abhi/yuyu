/**
 * Register-button wording, shared by the public registration card and the
 * dashboard's event-page preview. TEAM events register teams (and, when
 * allowed, solo entrants), so the wording says so instead of the individual
 * "Register — it's free" (docs/TEAMS.md). Pure: unit-tested directly
 * (tests/unit/registration-label.test.ts).
 */

/** `soloPolicy` as stored (TEAMS_ONLY, SOLO_ALLOWED, SOLO_WITH_MATCHING). */
export type RegistrationLabelTeam = { soloPolicy: string };

export function registrationActionLabel(
  state: { full: boolean; approvalRequired: boolean },
  team: RegistrationLabelTeam | null,
): string {
  if (team) {
    const teamsOnly = team.soloPolicy === "TEAMS_ONLY";
    if (state.full) return teamsOnly ? "Join the waitlist with your team" : "Join the waitlist";
    if (state.approvalRequired) return teamsOnly ? "Request a place for your team" : "Request a place";
    return teamsOnly ? "Register your team" : "Register a team or yourself";
  }
  return state.full ? "Join the waitlist" : state.approvalRequired ? "Request to join" : "Register — it's free";
}
