import { randomUUID } from "node:crypto";
import { EventPermission, EventPrivacyType, EventStatus, MembershipRole, RsvpStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (identity.id ? { user: { id: identity.id } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/outboxWorker", () => ({ startOutboxWorker: () => {} }));
vi.mock("@/lib/publicUrl", () => ({ getRequestOrigin: async () => "https://events.example.test" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import {
  checkInToListForUser,
  createCheckInListForUser,
  lookupListAttendeesForUser,
  reorderCheckInListsForUser,
  undoListCheckInForUser,
  updateCheckInListForUser,
} from "@/lib/core/checkinLists";
import { checkInByRsvpIdForUser } from "@/lib/core/checkin";
import { deleteRsvpForUser, restoreRsvpForUser } from "@/lib/core/rsvpAdmin";
import { GET as exportAttendees } from "@/app/api/exports/events/[eventId]/attendees/route";

const suffix = randomUUID().replace(/-/g, "");
const ids = {
  orgA: "", orgB: "", eventA: "", eventB: "",
  owner: "", admin: "", member: "", editor: "", checker: "", ownerB: "",
};
let orgASlug = "";
let orgBSlug = "";
const userIds: string[] = [];
let rsvpCounter = 0;

async function makeEvent(organisationId: string, label: string) {
  const event = await prisma.event.create({
    data: {
      organisationId,
      title: `Lists ${label}`,
      slug: `lists-${label}-${suffix}`,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-01T18:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      page: { create: { isPublished: true } },
    },
  });
  return event.id;
}

async function makeUser(label: string, membership?: { organisationId: string; role: MembershipRole }) {
  const user = await prisma.user.create({
    data: {
      email: `lists-${label}-${suffix}@example.test`,
      name: `Lists ${label}`,
      emailVerified: new Date(),
      ...(membership ? { memberships: { create: membership } } : {}),
    },
  });
  userIds.push(user.id);
  return user.id;
}

async function makeRsvp(status: RsvpStatus, eventId = ids.eventA) {
  rsvpCounter += 1;
  const email = `guest-${rsvpCounter}-${suffix}@example.test`;
  return prisma.rSVP.create({ data: { eventId, attendeeKey: `guest:${email}`, guestEmail: email, guestName: `Guest ${rsvpCounter}`, status } });
}

const ref = (overrides: Record<string, unknown> = {}) => ({ organisationSlug: orgASlug, eventId: ids.eventA, ...overrides });

async function newList(name: string, extra: Record<string, unknown> = {}) {
  const res = await createCheckInListForUser(ids.owner, ref({ name, ...extra }));
  if (!res.ok) throw new Error(res.error);
  return res.data!;
}

beforeAll(async () => {
  orgASlug = `lists-a-${suffix}`;
  orgBSlug = `lists-b-${suffix}`;
  ids.orgA = (await prisma.organisation.create({ data: { name: "Lists A", slug: orgASlug } })).id;
  ids.orgB = (await prisma.organisation.create({ data: { name: "Lists B", slug: orgBSlug } })).id;
  ids.owner = await makeUser("owner", { organisationId: ids.orgA, role: MembershipRole.OWNER });
  ids.admin = await makeUser("admin", { organisationId: ids.orgA, role: MembershipRole.ADMIN });
  ids.member = await makeUser("member", { organisationId: ids.orgA, role: MembershipRole.MEMBER });
  ids.editor = await makeUser("editor");
  ids.checker = await makeUser("checker");
  ids.ownerB = await makeUser("owner-b", { organisationId: ids.orgB, role: MembershipRole.OWNER });
  ids.eventA = await makeEvent(ids.orgA, "a");
  ids.eventB = await makeEvent(ids.orgB, "b");
  await prisma.eventCollaborator.create({ data: { eventId: ids.eventA, userId: ids.editor, permissions: [EventPermission.EDIT_DETAILS] } });
  await prisma.eventCollaborator.create({ data: { eventId: ids.eventA, userId: ids.checker, permissions: [EventPermission.CHECK_IN] } });
});

afterAll(async () => {
  await prisma.organisation.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe.sequential("check-in list management", () => {
  it("lets owners, admins and EDIT_DETAILS co-organisers manage lists, and audits it", async () => {
    for (const [actor, name] of [[ids.owner, "Owner list"], [ids.admin, "Admin list"], [ids.editor, "Editor list"]] as const) {
      const created = await createCheckInListForUser(actor, ref({ name }));
      expect(created).toMatchObject({ ok: true, data: { name, archived: false, requiresEntryCheckIn: false } });
      const renamed = await updateCheckInListForUser(actor, ref({ listId: created.ok ? created.data!.id : "", name: `${name} renamed` }));
      expect(renamed).toMatchObject({ ok: true, data: { name: `${name} renamed` } });
    }
    const audit = await prisma.auditEvent.findMany({ where: { organisationId: ids.orgA, action: { in: ["CHECK_IN_LIST_CREATED", "CHECK_IN_LIST_RENAMED"] } } });
    expect(audit).toHaveLength(6);
    expect(audit.every((row) => row.targetType === "CheckInList")).toBe(true);
  });

  it("refuses CHECK_IN-only co-organisers and plain members, and hides the event from other organisations", async () => {
    const [list] = await prisma.checkInList.findMany({ where: { eventId: ids.eventA }, take: 1 });
    for (const actor of [ids.checker, ids.member]) {
      expect(await createCheckInListForUser(actor, ref({ name: "Nope" }))).toEqual({ ok: false, error: "You do not have permission to manage check-in lists." });
      expect(await updateCheckInListForUser(actor, ref({ listId: list!.id, archived: true }))).toMatchObject({ ok: false, error: "You do not have permission to manage check-in lists." });
      expect(await reorderCheckInListsForUser(actor, ref({ listIds: [list!.id] }))).toMatchObject({ ok: false });
    }
    // Another organisation's owner, through either organisation's slug.
    expect(await createCheckInListForUser(ids.ownerB, ref({ name: "Cross" }))).toEqual({ ok: false, error: "Event not found." });
    expect(await createCheckInListForUser(ids.ownerB, ref({ organisationSlug: orgBSlug, name: "Cross" }))).toEqual({ ok: false, error: "Event not found." });
    expect(await updateCheckInListForUser(ids.ownerB, { organisationSlug: orgBSlug, eventId: ids.eventB, listId: list!.id, archived: true })).toEqual({ ok: false, error: "List not found." });
    expect(await createCheckInListForUser(null, ref({ name: "Anon" }))).toEqual({ ok: false, error: "You must be signed in." });
    expect(await prisma.checkInList.count({ where: { name: { in: ["Nope", "Cross", "Anon"] } } })).toBe(0);
  });

  it("keeps names unique among open lists, ignoring case, and frees a name on archive", async () => {
    const swag = await newList("Merch");
    expect(await createCheckInListForUser(ids.owner, ref({ name: "merch" }))).toMatchObject({ ok: false, error: expect.stringContaining("already a list") });
    expect(await updateCheckInListForUser(ids.owner, ref({ listId: swag.id, archived: true }))).toMatchObject({ ok: true, data: { archived: true } });
    const again = await newList("Merch");
    expect(again.id).not.toBe(swag.id);
    // Restoring the first one would duplicate the name.
    expect(await updateCheckInListForUser(ids.owner, ref({ listId: swag.id, archived: false }))).toMatchObject({ ok: false });
    expect(await updateCheckInListForUser(ids.owner, ref({ listId: swag.id, name: "Merch old" }))).toEqual({ ok: false, error: "Restore this list before changing it." });
    await expect(prisma.auditEvent.count({ where: { targetId: swag.id, action: "CHECK_IN_LIST_ARCHIVED" } })).resolves.toBe(1);
  });

  it("reorders only this event's lists", async () => {
    const lists = await prisma.checkInList.findMany({ where: { eventId: ids.eventA, archived: false }, orderBy: { sortOrder: "asc" } });
    const reversed = lists.map((list) => list.id).reverse();
    expect(await reorderCheckInListsForUser(ids.editor, ref({ listIds: reversed }))).toEqual({ ok: true });
    const after = await prisma.checkInList.findMany({ where: { eventId: ids.eventA, archived: false }, orderBy: { sortOrder: "asc" } });
    expect(after.map((list) => list.id)).toEqual(reversed);
    const foreign = await prisma.checkInList.create({ data: { eventId: ids.eventB, name: "Foreign" } });
    expect(await reorderCheckInListsForUser(ids.owner, ref({ listIds: [reversed[0], foreign.id] }))).toEqual({ ok: false, error: "List not found." });
  });
});

describe.sequential("checking guests into a list", () => {
  let swagId = "";

  beforeAll(async () => {
    swagId = (await newList("Swag")).id;
  });

  it("admits confirmed guests, asks for Override on the waitlist, and blocks pending and declined", async () => {
    const confirmed = await makeRsvp(RsvpStatus.CONFIRMED);
    const waitlisted = await makeRsvp(RsvpStatus.WAITLISTED);
    const pending = await makeRsvp(RsvpStatus.PENDING_APPROVAL);
    const rejected = await makeRsvp(RsvpStatus.REJECTED);
    const input = (rsvpId: string, force = false) => ref({ listId: swagId, rsvpId, force });

    expect(await checkInToListForUser(ids.checker, input(confirmed.id))).toMatchObject({ ok: true, data: { alreadyCheckedIn: false, listName: "Swag", message: "Checked in to Swag" } });
    expect(await checkInToListForUser(ids.checker, input(waitlisted.id))).toMatchObject({ ok: false, needsForce: true });
    expect(await checkInToListForUser(ids.checker, input(waitlisted.id, true))).toMatchObject({ ok: true, data: { alreadyCheckedIn: false } });
    expect(await checkInToListForUser(ids.checker, input(pending.id, true))).toEqual({ ok: false, error: "Registration is pending approval and cannot be checked in." });
    expect(await checkInToListForUser(ids.checker, input(rejected.id, true))).toEqual({ ok: false, error: "This registration was rejected." });
    await expect(prisma.checkInListRecord.count({ where: { listId: swagId } })).resolves.toBe(2);
  });

  it("accepts a ticket URL like entry, and refuses another event's ticket", async () => {
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    const other = await makeRsvp(RsvpStatus.CONFIRMED, ids.eventB);
    expect(await checkInToListForUser(ids.owner, ref({ listId: swagId, rawInput: `https://events.example.test/ticket/${guest.checkInToken}` }))).toMatchObject({ ok: true, data: { rsvpId: guest.id } });
    expect(await checkInToListForUser(ids.owner, ref({ listId: swagId, rawInput: other.checkInToken }))).toEqual({ ok: false, error: "This ticket is not for this event." });
    expect(await checkInToListForUser(ids.owner, ref({ listId: swagId, rsvpId: other.id }))).toEqual({ ok: false, error: "RSVP not found." });
  });

  it("only lets people with check-in rights scan", async () => {
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    expect(await checkInToListForUser(ids.editor, ref({ listId: swagId, rsvpId: guest.id }))).toEqual({ ok: false, error: "You do not have permission to operate check-in." });
    expect(await checkInToListForUser(ids.member, ref({ listId: swagId, rsvpId: guest.id }))).toEqual({ ok: false, error: "You do not have permission to operate check-in." });
    expect(await checkInToListForUser(ids.ownerB, ref({ organisationSlug: orgBSlug, listId: swagId, rsvpId: guest.id }))).toEqual({ ok: false, error: "Event not found." });
    expect(await lookupListAttendeesForUser(ids.ownerB, ref({ listId: swagId, query: "Guest" }))).toEqual({ ok: false, error: "Event not found." });
    await expect(prisma.checkInListRecord.count({ where: { rsvpId: guest.id } })).resolves.toBe(0);
  });

  it("reports a duplicate with the list and time, and keeps one record under concurrency", async () => {
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    const results = await Promise.all([
      checkInToListForUser(ids.checker, ref({ listId: swagId, rsvpId: guest.id })),
      checkInToListForUser(ids.owner, ref({ listId: swagId, rawInput: guest.checkInToken })),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => (result.ok ? result.data!.alreadyCheckedIn : null)).sort()).toEqual([false, true]);
    await expect(prisma.checkInListRecord.count({ where: { listId: swagId, rsvpId: guest.id } })).resolves.toBe(1);
    await expect(prisma.checkInListEvent.count({ where: { listId: swagId, rsvpId: guest.id, action: "CHECKED_IN" } })).resolves.toBe(1);

    const again = await checkInToListForUser(ids.checker, ref({ listId: swagId, rsvpId: guest.id }));
    expect(again).toMatchObject({ ok: true, data: { alreadyCheckedIn: true, message: expect.stringMatching(/^Already checked in to Swag at \d{1,2}:\d{2} (AM|PM)$/) } });
  });

  it("undoes a list check-in and records it in the history", async () => {
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    await checkInToListForUser(ids.checker, ref({ listId: swagId, rsvpId: guest.id }));
    expect(await undoListCheckInForUser(ids.checker, ref({ listId: swagId, rsvpId: guest.id }))).toEqual({ ok: true });
    expect(await undoListCheckInForUser(ids.checker, ref({ listId: swagId, rsvpId: guest.id }))).toEqual({ ok: false, error: "This guest is not checked in to this list." });
    expect(await undoListCheckInForUser(ids.editor, ref({ listId: swagId, rsvpId: guest.id }))).toMatchObject({ ok: false, error: "You do not have permission to operate check-in." });
    await expect(prisma.checkInListRecord.count({ where: { rsvpId: guest.id } })).resolves.toBe(0);
    const history = await prisma.checkInListEvent.findMany({ where: { rsvpId: guest.id }, orderBy: { occurredAt: "asc" } });
    expect(history.map((row) => [row.action, row.source, row.actorUserId])).toEqual([
      ["CHECKED_IN", "online", ids.checker],
      ["CHECK_IN_UNDONE", "online", ids.checker],
    ]);
  });

  it("requires entry check-in when the list says so", async () => {
    const lunch = await newList("Lunch", { requiresEntryCheckIn: true });
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    expect(await checkInToListForUser(ids.checker, ref({ listId: lunch.id, rsvpId: guest.id }))).toEqual({ ok: false, error: "Check this guest in at entry before marking them for Lunch." });
    expect(await checkInByRsvpIdForUser(ids.checker, ref({ rsvpId: guest.id }))).toMatchObject({ ok: true });
    expect(await checkInToListForUser(ids.checker, ref({ listId: lunch.id, rsvpId: guest.id }))).toMatchObject({ ok: true, data: { alreadyCheckedIn: false } });
  });

  it("treats archived lists as read-only", async () => {
    const workshop = await newList("Workshop B");
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    const other = await makeRsvp(RsvpStatus.CONFIRMED);
    await checkInToListForUser(ids.checker, ref({ listId: workshop.id, rsvpId: guest.id }));
    await updateCheckInListForUser(ids.owner, ref({ listId: workshop.id, archived: true }));
    expect(await checkInToListForUser(ids.checker, ref({ listId: workshop.id, rsvpId: other.id }))).toEqual({ ok: false, error: "This list is archived and read-only." });
    expect(await undoListCheckInForUser(ids.checker, ref({ listId: workshop.id, rsvpId: guest.id }))).toEqual({ ok: false, error: "This list is archived and read-only." });
    await expect(prisma.checkInListRecord.count({ where: { listId: workshop.id } })).resolves.toBe(1);
  });

  it("never touches entry check-in", async () => {
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    await checkInToListForUser(ids.checker, ref({ listId: swagId, rsvpId: guest.id }));
    await undoListCheckInForUser(ids.checker, ref({ listId: swagId, rsvpId: guest.id }));
    await checkInToListForUser(ids.checker, ref({ listId: swagId, rsvpId: guest.id }));
    const after = await prisma.rSVP.findUniqueOrThrow({ where: { id: guest.id } });
    expect(after.checkedInAt).toBeNull();
    await expect(prisma.checkInEvent.count({ where: { rsvpId: guest.id } })).resolves.toBe(0);
    // And entry check-in still works on its own afterwards.
    expect(await checkInByRsvpIdForUser(ids.checker, ref({ rsvpId: guest.id }))).toMatchObject({ ok: true, data: { alreadyCheckedIn: false } });
    await expect(prisma.checkInEvent.count({ where: { rsvpId: guest.id, action: "CHECKED_IN" } })).resolves.toBe(1);
    await expect(prisma.checkInListRecord.count({ where: { rsvpId: guest.id } })).resolves.toBe(1);
  });

  it("finds guests with their state in this list", async () => {
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    await checkInToListForUser(ids.checker, ref({ listId: swagId, rsvpId: guest.id }));
    const res = await lookupListAttendeesForUser(ids.checker, ref({ listId: swagId, query: guest.guestName! }));
    expect(res).toMatchObject({ ok: true, data: { rows: [{ rsvpId: guest.id, entryCheckedInAt: null, listCheckedInAt: expect.any(String) }] } });
  });
});

describe.sequential("list check-ins with exports, removal and deletion", () => {
  it("adds a column per list to the attendee CSV", async () => {
    const eventId = await makeEvent(ids.orgA, "export");
    const list = await prisma.checkInList.create({ data: { eventId, name: "Badge pickup" } });
    const archived = await prisma.checkInList.create({ data: { eventId, name: "Old", archived: true, sortOrder: 1 } });
    const guest = await makeRsvp(RsvpStatus.CONFIRMED, eventId);
    const checkedInAt = new Date("2035-01-01T11:00:00.000Z");
    await prisma.checkInListRecord.create({ data: { listId: list.id, rsvpId: guest.id, source: "online", checkedInAt } });
    await prisma.checkInListRecord.create({ data: { listId: archived.id, rsvpId: guest.id, source: "mobile-scan", checkedInAt } });

    identity.id = ids.admin;
    const response = await exportAttendees(new Request(`https://events.example.test/api/exports/events/${eventId}/attendees`), { params: Promise.resolve({ eventId }) });
    const [header, row] = (await response.text()).replace(/^﻿/, "").split("\n");
    // The attendance confirmation columns come last (blank: nobody at this event was asked).
    expect(header!.endsWith(",Check-in: Badge pickup,Check-in: Old (archived),Attendance confirmation,Attendance note")).toBe(true);
    expect(row!.endsWith(`,${checkedInAt.toISOString()},${checkedInAt.toISOString()},,`)).toBe(true);

    // A CHECK_IN-only co-organiser still cannot download it.
    await prisma.eventCollaborator.create({ data: { eventId, userId: ids.checker, permissions: [EventPermission.CHECK_IN] } });
    identity.id = ids.checker;
    expect((await exportAttendees(new Request("https://events.example.test/"), { params: Promise.resolve({ eventId }) })).status).toBe(404);
    identity.id = "";
  });

  it("restores list check-ins when a removed guest is restored", async () => {
    const list = await newList("Tote bag");
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    await checkInToListForUser(ids.checker, ref({ listId: list.id, rsvpId: guest.id }));
    const removed = await deleteRsvpForUser(ids.owner, ref({ rsvpId: guest.id }));
    expect(removed).toMatchObject({ ok: true });
    await expect(prisma.checkInListRecord.count({ where: { listId: list.id } })).resolves.toBe(0);
    // History survives the RSVP, detached like CheckInEvent.
    await expect(prisma.checkInListEvent.count({ where: { listId: list.id, rsvpId: null } })).resolves.toBe(1);
    expect(await restoreRsvpForUser(ids.owner, { organisationSlug: orgASlug, undoId: removed.ok ? removed.data!.undoId : "" })).toMatchObject({ ok: true });
    await expect(prisma.checkInListRecord.count({ where: { listId: list.id } })).resolves.toBe(1);
  });

  it("cascades with the RSVP and the event, and keeps rows when the actor is deleted", async () => {
    const eventId = await makeEvent(ids.orgA, "cascade");
    const actor = await makeUser("actor", { organisationId: ids.orgA, role: MembershipRole.ADMIN });
    const list = await createCheckInListForUser(actor, { organisationSlug: orgASlug, eventId, name: "Cascade" });
    const listId = list.ok ? list.data!.id : "";
    const a = await makeRsvp(RsvpStatus.CONFIRMED, eventId);
    const b = await makeRsvp(RsvpStatus.CONFIRMED, eventId);
    await checkInToListForUser(actor, { organisationSlug: orgASlug, eventId, listId, rsvpId: a.id });
    await checkInToListForUser(actor, { organisationSlug: orgASlug, eventId, listId, rsvpId: b.id });

    await prisma.user.delete({ where: { id: actor } });
    expect(await prisma.checkInListRecord.findMany({ where: { listId }, select: { actorUserId: true } })).toEqual([{ actorUserId: null }, { actorUserId: null }]);

    await prisma.rSVP.delete({ where: { id: a.id } });
    await expect(prisma.checkInListRecord.count({ where: { listId } })).resolves.toBe(1);

    await prisma.event.delete({ where: { id: eventId } });
    await expect(prisma.checkInList.count({ where: { id: listId } })).resolves.toBe(0);
    await expect(prisma.checkInListRecord.count({ where: { listId } })).resolves.toBe(0);
    await expect(prisma.checkInListEvent.count({ where: { listId } })).resolves.toBe(0);
  });

  it("enforces the record and name constraints in the database", async () => {
    const list = await prisma.checkInList.create({ data: { eventId: ids.eventA, name: "Constraint" } });
    const guest = await makeRsvp(RsvpStatus.CONFIRMED);
    await prisma.checkInListRecord.create({ data: { listId: list.id, rsvpId: guest.id, source: "online" } });
    await expect(prisma.checkInListRecord.create({ data: { listId: list.id, rsvpId: guest.id, source: "online" } })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.checkInListRecord.create({ data: { listId: list.id, rsvpId: (await makeRsvp(RsvpStatus.CONFIRMED)).id, source: "venue-station" } })).rejects.toThrow();
    await expect(prisma.checkInList.create({ data: { eventId: ids.eventA, name: "CONSTRAINT" } })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.checkInList.create({ data: { eventId: ids.eventA, name: " padded " } })).rejects.toThrow();
  });
});
