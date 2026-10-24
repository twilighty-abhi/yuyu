import type { RsvpStatus } from "@prisma/client";
import { z } from "zod";
import { gateCheckInForStatus, type CheckInGate } from "@/lib/checkIn";
import { formatTime } from "@/lib/format/datetime";

/*
 * Custom check-in lists ("Swag collection", "Lunch – Day 1"): validation
 * schemas and the pure eligibility rules shared by the Server Actions, the
 * check-in desk and (later) the mobile API. No I/O here, so it is safe in
 * client components and unit tests. Mutations live in lib/core/checkinLists.ts
 * and lib/checkInListMutations.ts.
 */

/** Lists per event, archived ones included (they can be restored). */
export const MAX_CHECK_IN_LISTS = 30;
export const CHECK_IN_LIST_NAME_MAX = 60;

/** Sources a list check-in can record; must match `CheckInListRecord_known_source`. */
export const CHECK_IN_LIST_SOURCES = ["online", "mobile-scan", "mobile-manual"] as const;
export type CheckInListSource = (typeof CHECK_IN_LIST_SOURCES)[number];

const id = z.string().trim().min(1).max(128);
const target = { organisationSlug: z.string().trim().min(1).max(120), eventId: id };

export const checkInListNameSchema = z
  .string()
  .trim()
  .min(1, "Give the list a name.")
  .max(CHECK_IN_LIST_NAME_MAX, `Keep the name to ${CHECK_IN_LIST_NAME_MAX} characters or fewer.`)
  // Control characters would break CSV headers and screen-reader output.
  .refine((value) => !/\p{Cc}/u.test(value), "Use letters, numbers and punctuation only.");

export const createCheckInListSchema = z
  .object({ ...target, name: checkInListNameSchema, requiresEntryCheckIn: z.boolean().optional() })
  .strict();

export const updateCheckInListSchema = z
  .object({
    ...target,
    listId: id,
    name: checkInListNameSchema.optional(),
    requiresEntryCheckIn: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.requiresEntryCheckIn !== undefined || value.archived !== undefined, {
    message: "Nothing to change.",
  });

export const reorderCheckInListsSchema = z
  .object({ ...target, listIds: z.array(id).min(1).max(MAX_CHECK_IN_LISTS) })
  .strict()
  .refine((value) => new Set(value.listIds).size === value.listIds.length, { message: "Each list can appear only once.", path: ["listIds"] });

/** Scan or search: a ticket URL / raw token / typed code, or an RSVP id from search. Exactly one. */
export const listCheckInSchema = z
  .object({
    ...target,
    listId: id,
    rawInput: z.string().trim().min(1).max(2048).optional(),
    rsvpId: id.optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.rawInput) !== Boolean(value.rsvpId), { message: "Scan a ticket or choose a guest." });

export const undoListCheckInSchema = z.object({ ...target, listId: id, rsvpId: id }).strict();

export const listLookupSchema = z.object({ ...target, listId: id, query: z.string().trim().min(2).max(200) }).strict();

export type CheckInListGateInput = {
  status: RsvpStatus;
  /** Entry check-in time (`RSVP.checkedInAt`), or null. */
  entryCheckedInAt: Date | string | null;
  force: boolean;
  list: { name: string; archived: boolean; requiresEntryCheckIn: boolean };
};

/**
 * Whether a registration can be checked into a custom list. It reuses the
 * entry gate (`gateCheckInForStatus`) unchanged: confirmed guests pass, the
 * waitlist needs the same staff Override, and pending or declined
 * registrations stay blocked. An archived list is read-only, and a list that
 * requires entry check-in refuses guests who have not come through the door.
 */
export function gateListCheckIn(input: CheckInListGateInput): CheckInGate {
  if (input.list.archived) {
    return { ok: false, reason: "This list is archived and read-only.", needsForce: false, blocked: true };
  }
  const statusGate = gateCheckInForStatus(input.status, input.force);
  if (!statusGate.ok) return statusGate;
  if (input.list.requiresEntryCheckIn && !input.entryCheckedInAt) {
    return {
      ok: false,
      reason: `Check this guest in at entry before marking them for ${input.list.name}.`,
      needsForce: false,
      blocked: true,
    };
  }
  return { ok: true };
}

/** "Already checked in to Swag at 10:42", in the event's time zone, like the entry desk. */
export function alreadyInListMessage(listName: string, checkedInAt: Date | string, timeZone: string) {
  return `Already checked in to ${listName} at ${formatTime(checkedInAt, timeZone)}`;
}

/** Statuses counted as "eligible" in a list's collected / eligible numbers. */
export function isEligibleForListCount(row: { status: RsvpStatus; entryCheckedInAt: Date | string | null }, list: { requiresEntryCheckIn: boolean }) {
  return row.status === "CONFIRMED" && (!list.requiresEntryCheckIn || Boolean(row.entryCheckedInAt));
}
