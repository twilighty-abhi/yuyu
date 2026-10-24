import { describe, expect, it } from "vitest";
import { gateCheckInForStatus } from "@/lib/checkIn";
import {
  CHECK_IN_LIST_NAME_MAX,
  MAX_CHECK_IN_LISTS,
  alreadyInListMessage,
  checkInListNameSchema,
  createCheckInListSchema,
  gateListCheckIn,
  isEligibleForListCount,
  listCheckInSchema,
  listLookupSchema,
  reorderCheckInListsSchema,
  undoListCheckInSchema,
  updateCheckInListSchema,
} from "@/lib/checkInLists";

const target = { organisationSlug: "org", eventId: "event_1" };
const openList = { name: "Swag", archived: false, requiresEntryCheckIn: false };

describe("check-in list schemas", () => {
  it("trims names and bounds their length", () => {
    expect(checkInListNameSchema.parse("  Swag collection  ")).toBe("Swag collection");
    expect(checkInListNameSchema.safeParse("   ").success).toBe(false);
    expect(checkInListNameSchema.safeParse("x".repeat(CHECK_IN_LIST_NAME_MAX)).success).toBe(true);
    expect(checkInListNameSchema.safeParse("x".repeat(CHECK_IN_LIST_NAME_MAX + 1)).success).toBe(false);
    expect(checkInListNameSchema.safeParse("Lunch\u0000Day 1").success).toBe(false);
    expect(checkInListNameSchema.parse("Lunch – Day 1")).toBe("Lunch – Day 1");
  });

  it("accepts a create request and rejects unknown keys", () => {
    expect(createCheckInListSchema.safeParse({ ...target, name: "Swag" }).success).toBe(true);
    expect(createCheckInListSchema.safeParse({ ...target, name: "Swag", requiresEntryCheckIn: true }).success).toBe(true);
    expect(createCheckInListSchema.safeParse({ ...target, name: "Swag", sortOrder: 3 }).success).toBe(false);
    expect(createCheckInListSchema.safeParse({ ...target, name: "Swag", organisationId: "other" }).success).toBe(false);
  });

  it("requires at least one change on update", () => {
    expect(updateCheckInListSchema.safeParse({ ...target, listId: "l1" }).success).toBe(false);
    expect(updateCheckInListSchema.safeParse({ ...target, listId: "l1", archived: true }).success).toBe(true);
    expect(updateCheckInListSchema.safeParse({ ...target, listId: "l1", name: "Lunch" }).success).toBe(true);
    expect(updateCheckInListSchema.safeParse({ ...target, listId: "l1", requiresEntryCheckIn: false }).success).toBe(true);
  });

  it("rejects duplicate and oversized reorders", () => {
    expect(reorderCheckInListsSchema.safeParse({ ...target, listIds: ["a", "b"] }).success).toBe(true);
    expect(reorderCheckInListsSchema.safeParse({ ...target, listIds: ["a", "a"] }).success).toBe(false);
    expect(reorderCheckInListsSchema.safeParse({ ...target, listIds: [] }).success).toBe(false);
    expect(reorderCheckInListsSchema.safeParse({ ...target, listIds: Array.from({ length: MAX_CHECK_IN_LISTS + 1 }, (_, i) => `l${i}`) }).success).toBe(false);
  });

  it("takes exactly one of a ticket input or an RSVP id", () => {
    expect(listCheckInSchema.safeParse({ ...target, listId: "l1", rawInput: "https://x.test/ticket/abcdefgh123" }).success).toBe(true);
    expect(listCheckInSchema.safeParse({ ...target, listId: "l1", rsvpId: "r1", force: true }).success).toBe(true);
    expect(listCheckInSchema.safeParse({ ...target, listId: "l1" }).success).toBe(false);
    expect(listCheckInSchema.safeParse({ ...target, listId: "l1", rawInput: "abc", rsvpId: "r1" }).success).toBe(false);
    expect(listCheckInSchema.safeParse({ ...target, listId: "l1", rawInput: "x".repeat(2049) }).success).toBe(false);
  });

  it("validates undo and lookup", () => {
    expect(undoListCheckInSchema.safeParse({ ...target, listId: "l1", rsvpId: "r1" }).success).toBe(true);
    expect(undoListCheckInSchema.safeParse({ ...target, listId: "l1" }).success).toBe(false);
    expect(listLookupSchema.safeParse({ ...target, listId: "l1", query: "a" }).success).toBe(false);
    expect(listLookupSchema.safeParse({ ...target, listId: "l1", query: "ad" }).success).toBe(true);
  });
});

describe("gateListCheckIn", () => {
  it("reuses the entry gate for every status, including the waitlist override", () => {
    for (const status of ["CONFIRMED", "WAITLISTED", "PENDING_APPROVAL", "REJECTED"] as const) {
      for (const force of [false, true]) {
        expect(gateListCheckIn({ status, entryCheckedInAt: null, force, list: openList })).toEqual(gateCheckInForStatus(status, force));
      }
    }
  });

  it("lets only confirmed guests in without Override", () => {
    expect(gateListCheckIn({ status: "CONFIRMED", entryCheckedInAt: null, force: false, list: openList }).ok).toBe(true);
    expect(gateListCheckIn({ status: "WAITLISTED", entryCheckedInAt: null, force: false, list: openList })).toMatchObject({ ok: false, needsForce: true });
    expect(gateListCheckIn({ status: "PENDING_APPROVAL", entryCheckedInAt: null, force: true, list: openList })).toMatchObject({ ok: false, blocked: true });
    expect(gateListCheckIn({ status: "REJECTED", entryCheckedInAt: null, force: true, list: openList })).toMatchObject({ ok: false, blocked: true });
  });

  it("requires entry check-in when the list says so", () => {
    const list = { ...openList, requiresEntryCheckIn: true };
    expect(gateListCheckIn({ status: "CONFIRMED", entryCheckedInAt: null, force: false, list })).toMatchObject({ ok: false, blocked: true, reason: expect.stringContaining("at entry") });
    expect(gateListCheckIn({ status: "CONFIRMED", entryCheckedInAt: new Date(), force: false, list }).ok).toBe(true);
    // Status is checked first, so a declined guest is never told to go to the door.
    expect(gateListCheckIn({ status: "REJECTED", entryCheckedInAt: null, force: false, list })).toMatchObject({ reason: "This registration was rejected." });
  });

  it("treats an archived list as read-only", () => {
    expect(gateListCheckIn({ status: "CONFIRMED", entryCheckedInAt: new Date(), force: false, list: { ...openList, archived: true } })).toMatchObject({ ok: false, blocked: true, reason: "This list is archived and read-only." });
  });
});

describe("list messages and counts", () => {
  it("formats the duplicate message in the event time zone", () => {
    expect(alreadyInListMessage("Swag", "2030-01-01T09:42:00.000Z", "UTC")).toBe("Already checked in to Swag at 9:42 AM");
    expect(alreadyInListMessage("Lunch", "2030-01-01T09:42:00.000Z", "Asia/Kolkata")).toBe("Already checked in to Lunch at 3:12 PM");
  });

  it("counts confirmed guests as eligible, and only those through the door when entry is required", () => {
    expect(isEligibleForListCount({ status: "CONFIRMED", entryCheckedInAt: null }, { requiresEntryCheckIn: false })).toBe(true);
    expect(isEligibleForListCount({ status: "WAITLISTED", entryCheckedInAt: null }, { requiresEntryCheckIn: false })).toBe(false);
    expect(isEligibleForListCount({ status: "CONFIRMED", entryCheckedInAt: null }, { requiresEntryCheckIn: true })).toBe(false);
    expect(isEligibleForListCount({ status: "CONFIRMED", entryCheckedInAt: "2030-01-01T09:00:00.000Z" }, { requiresEntryCheckIn: true })).toBe(true);
  });
});
