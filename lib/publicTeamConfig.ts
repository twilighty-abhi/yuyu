import { RegistrationMode, type SoloPolicy } from "@prisma/client";
import type { TeamRegistrationConfig } from "@/components/rsvp/TeamRegistrationFields";

/**
 * The team settings the public registration form needs (docs/TEAMS.md), or
 * null for an INDIVIDUAL event. Only event-level settings: never team or
 * member data.
 */
export function publicTeamRegistrationConfig(event: {
  registrationMode: RegistrationMode;
  teamMinSize: number | null;
  teamMaxSize: number | null;
  soloPolicy: SoloPolicy;
}): TeamRegistrationConfig | null {
  if (event.registrationMode !== RegistrationMode.TEAM) return null;
  return { soloPolicy: event.soloPolicy, teamMinSize: event.teamMinSize, teamMaxSize: event.teamMaxSize };
}
