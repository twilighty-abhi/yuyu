import "server-only";

import { cache } from "react";
import type { RegistrationFieldType } from "@prisma/client";
import { prisma } from "@/lib/db";
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

export type RegistrationFieldRow = { id: string; key: string; label: string; type: RegistrationFieldType; required: boolean; sortOrder: number; options: string[]; helpText: string; placeholder: string; settings: FieldSettings };

export const loadRegistrationFields = cache(async (eventId: string): Promise<RegistrationFieldRow[]> => {
  const form = await prisma.eventRegistrationForm.findUnique({ where: { eventId }, include: { fields: { orderBy: { sortOrder: "asc" } } } });
  return (form?.fields ?? []).map((field) => ({ id: field.id, sortOrder: field.sortOrder, ...toFieldDefinition(field) }));
});

export const MAX_BROWSER_ATTENDEES = 250;

/** The most recent registrations for the browser (organisation admins only). */
export const loadAttendees = cache(async (eventId: string, origin: string) => {
  const rsvps = await prisma.rSVP.findMany({
    where: { eventId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      answers: { include: { field: true } },
      checkInListRecords: { select: { checkedInAt: true, list: { select: { name: true, archived: true } } }, orderBy: { list: { sortOrder: "asc" } } },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_BROWSER_ATTENDEES + 1,
  });
  const attendees = rsvps.slice(0, MAX_BROWSER_ATTENDEES).map((rsvp) => ({
    id: rsvp.id,
    status: rsvp.status,
    createdAt: rsvp.createdAt.toISOString(),
    guestEmail: rsvp.guestEmail,
    guestName: rsvp.guestName,
    user: rsvp.user ? { id: rsvp.user.id, name: rsvp.user.name, email: rsvp.user.email } : null,
    checkedInAt: rsvp.checkedInAt?.toISOString() ?? null,
    /** Custom check-in lists this guest is in (never changes entry check-in). */
    listCheckIns: rsvp.checkInListRecords.map((record) => ({
      listName: record.list.archived ? `${record.list.name} (archived)` : record.list.name,
      checkedInAt: record.checkedInAt.toISOString(),
    })),
    ticketUrl: `${origin}/ticket/${rsvp.checkInToken}`,
    rawAnswers: rsvp.answers.map((answer) => ({
      fieldId: answer.fieldId,
      valueText: answer.valueText,
      valueBool: answer.valueBool,
      valueNumber: answer.valueNumber,
      valueDate: answer.valueDate?.toISOString() ?? null,
    })),
    answers: (() => {
      const byField: Record<string, { label: string; values: string[] }> = {};
      for (const answer of rsvp.answers) {
        const value =
          answer.valueText ??
          (answer.valueBool != null ? (answer.valueBool ? "Yes" : "No") : null) ??
          (answer.valueNumber != null ? String(answer.valueNumber) : null) ??
          (answer.valueDate != null ? new Date(answer.valueDate).toLocaleDateString() : null);
        if (!value) continue;
        if (!byField[answer.field.id]) byField[answer.field.id] = { label: answer.field.label, values: [] };
        byField[answer.field.id]!.values.push(value);
      }
      return Object.values(byField).map((entry) => ({ label: entry.label, value: entry.values.join(", ") }));
    })(),
  }));
  return { attendees, truncated: rsvps.length > MAX_BROWSER_ATTENDEES };
});

export type AttendeeRows = Awaited<ReturnType<typeof loadAttendees>>["attendees"];

export const loadEventInvites = cache(async (eventId: string) => {
  const invites = await prisma.eventInvite.findMany({ where: { eventId }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, createdAt: true } });
  return invites.map((invite) => ({ ...invite, createdAt: invite.createdAt.toISOString() }));
});
