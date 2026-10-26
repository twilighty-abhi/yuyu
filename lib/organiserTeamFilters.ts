/*
 * The Guests → Teams status filters (docs/TEAMS.md), pure so the client
 * (chips, saved views) and the server query share one allow-list.
 * `incomplete`: fewer members than the event's minimum team size.
 * `looking`: the team is listed as looking for members.
 */
export const ORGANISER_TEAM_FILTERS = ["all", "going", "waitlist", "approve", "declined", "incomplete", "looking"] as const;
export type OrganiserTeamFilter = (typeof ORGANISER_TEAM_FILTERS)[number];
