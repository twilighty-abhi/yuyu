import "server-only";

import { cache } from "react";
import type { RegistrationFieldType, RegistrationMode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { countConfirmedForEvent } from "@/lib/rsvpCapacity";
import { toFieldDefinition, type FieldSettings } from "@/lib/registrationFields";

/*
 * Data loaders shared by several event-dashboard panels. Wrapped in React
 * `cache()` so the header and multiple panels can ask for the same numbers in
 * one request without repeating queries. Callers must check permissions
 * (see EventDashboardContext.permissions) before calling the guest-level ones.
 */

export type RsvpStatusCounts = { total: number; confirmed: number; waitlisted: number; pendingApproval: number; rejected: number; checkedIn: number };

export const loadRsvpStatusCounts = cache(async (eventId: string): Promise<RsvpStatusCounts> => {
  const [groups, checkedIn] = await Promise.all([
    prisma.rSVP.groupBy({ by: ["status"], where: { eventId }, _count: { _all: true } }),
    prisma.rSVP.count({ where: { eventId, checkedInAt: { not: null } } }),
  ]);
  const of = (status: string) => groups.find((group) => group.status === status)?._count._all ?? 0;
  return {
    total: groups.reduce((sum, group) => sum + group._count._all, 0),
    confirmed: of("CONFIRMED"),
    waitlisted: of("WAITLISTED"),
    pendingApproval: of("PENDING_APPROVAL"),
    rejected: of("REJECTED"),
    checkedIn,
  };
});

/**
 * The number compared with `Event.capacity`: confirmed RSVPs on INDIVIDUAL
 * events, confirmed units (teams plus solo registrants) on TEAM events.
 */
export const loadCapacityUsed = cache(async (eventId: string, registrationMode: RegistrationMode): Promise<number> => countConfirmedForEvent(eventId, registrationMode));

export type RegistrationFieldRow = { id: string; key: string; label: string; type: RegistrationFieldType; required: boolean; sortOrder: number; options: string[]; helpText: string; placeholder: string; settings: FieldSettings };

export const loadRegistrationFields = cache(async (eventId: string): Promise<RegistrationFieldRow[]> => {
  const form = await prisma.eventRegistrationForm.findUnique({ where: { eventId }, include: { fields: { orderBy: { sortOrder: "asc" } } } });
  return (form?.fields ?? []).map((field) => ({ id: field.id, sortOrder: field.sortOrder, ...toFieldDefinition(field) }));
});
