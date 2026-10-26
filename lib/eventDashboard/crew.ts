import "server-only";

import { cache } from "react";
import {
  FOOD_PREFERENCE_SUGGESTIONS,
  crewJoinPath,
  getCrewJoinLink,
  listCrewForOrganiser,
  type OrganiserCrewContext,
  type OrganiserCrewMember,
} from "@/lib/core/crew";
import { EventPageSectionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { EventDashboardContext } from "@/lib/eventDashboard/context";

/*
 * Guests → Crew data (docs/CREW.md). Callers must have checked
 * `ctx.permissions.canManageRegistrations` (the rule the crew actions
 * re-check on the server). Crew emails and food preferences are organiser
 * data; ticket tokens never leave lib/core/crew.ts.
 */

export type DashboardCrew = {
  members: OrganiserCrewMember[];
  food: Array<{ label: string; count: number }>;
  /** Site-relative sign-up path (`/crew/<token>`), or null when the link is off. */
  joinPath: string | null;
  /** Offered in the food preference field; any short text is accepted. */
  foodSuggestions: string[];
  /** Whether the public Crew section (Event page → Sections) is switched on. */
  sectionOn: boolean;
  /** Whether this person may switch it on (`EDIT_DETAILS`, the page editor's rule). */
  canEditPage: boolean;
};

function crewContext(ctx: EventDashboardContext): OrganiserCrewContext {
  return { organisationId: ctx.organisation.id, eventId: ctx.event.id, actorUserId: ctx.userId };
}

export const loadEventCrew = cache(async (ctx: EventDashboardContext): Promise<DashboardCrew> => {
  const crew = crewContext(ctx);
  const [list, link, section] = await Promise.all([
    listCrewForOrganiser(crew),
    getCrewJoinLink(crew),
    prisma.eventPageSection.findFirst({ where: { type: EventPageSectionType.CREW, page: { eventId: ctx.event.id } }, select: { isVisible: true } }),
  ]);
  return {
    members: list.members,
    food: list.food,
    joinPath: link ? crewJoinPath(link.token) : null,
    foodSuggestions: [...FOOD_PREFERENCE_SUGGESTIONS],
    sectionOn: section?.isVisible ?? false,
    canEditPage: ctx.permissions.canEditPageContent,
  };
});
