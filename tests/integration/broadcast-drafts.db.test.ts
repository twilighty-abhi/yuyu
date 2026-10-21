import { randomUUID } from "node:crypto";
import { EventPrivacyType, EventStatus, MembershipRole, RsvpStatus } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (identity.id ? { user: { id: identity.id } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/outboxWorker", () => ({ startOutboxWorker: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import {
  discardEventBroadcastDraft,
  loadEventBroadcastDraft,
  saveEventBroadcastDraft,
  sendEventBroadcast,
  sendEventBroadcastTest,
} from "@/app/actions/broadcasts";

const suffix = randomUUID().replace(/-/g, "");
let orgAId: string;
let orgASlug: string;
let orgBId: string;
let orgBSlug: string;
let ownerId: string;
let adminId: string;
let memberId: string;
let ownerBId: string;
let eventId: string;
let eventBId: string;
const userIds: string[] = [];
let eventCounter = 0;

async function makeEvent(organisationId: string) {
  eventCounter += 1;
  const event = await prisma.event.create({
    data: {
      organisationId,
      title: `Draft event ${eventCounter}`,
      slug: `draft-event-${eventCounter}-${suffix}`,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-01T12:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      page: { create: { isPublished: true } },
    },
  });
  return event.id;
}

const input = (overrides: Record<string, unknown> = {}) => ({
  organisationSlug: orgASlug,
  eventId,
  subject: "Doors open at six",
  body: "<p>Hello {{name}}</p>",
  design: "minimal",
  statuses: ["CONFIRMED"],
  attendance: "ANY",
  templateId: "update",
  ...overrides,
});

const ref = (overrides: Record<string, unknown> = {}) => ({ organisationSlug: orgASlug, eventId, ...overrides });

beforeAll(async () => {
  orgASlug = `drafts-a-${suffix}`;
  orgBSlug = `drafts-b-${suffix}`;
  orgAId = (await prisma.organisation.create({ data: { name: "Drafts A", slug: orgASlug } })).id;
  orgBId = (await prisma.organisation.create({ data: { name: "Drafts B", slug: orgBSlug } })).id;
  const make = async (label: string, organisationId: string, role: MembershipRole) => {
    const user = await prisma.user.create({
      data: {
        email: `drafts-${label}-${suffix}@example.test`,
        name: `Drafts ${label}`,
        emailVerified: new Date(),
        memberships: { create: { organisationId, role } },
      },
    });
    userIds.push(user.id);
    return user.id;
  };
  ownerId = await make("owner", orgAId, MembershipRole.OWNER);
  adminId = await make("admin", orgAId, MembershipRole.ADMIN);
  memberId = await make("member", orgAId, MembershipRole.MEMBER);
  ownerBId = await make("owner-b", orgBId, MembershipRole.OWNER);
  eventId = await makeEvent(orgAId);
  eventBId = await makeEvent(orgBId);
  await prisma.rSVP.create({ data: { eventId, attendeeKey: `guest:drafts-${suffix}`, guestName: "Guest", guestEmail: `drafts-guest-${suffix}@example.test`, status: RsvpStatus.CONFIRMED } });
});

beforeEach(async () => {
  await prisma.eventBroadcastDraft.deleteMany({ where: { userId: { in: userIds } } });
  identity.id = ownerId;
});

afterAll(async () => {
  const broadcasts = await prisma.eventBroadcast.findMany({ where: { event: { organisationId: { in: [orgAId, orgBId] } } }, select: { id: true } });
  await prisma.outboxMessage.deleteMany({
    where: { OR: broadcasts.map((broadcast) => ({ payload: { path: ["broadcastId"], equals: broadcast.id } })).concat([{ payload: { path: ["eventId"], equals: eventId } }]) },
  });
  await prisma.organisation.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe("event broadcast drafts", () => {
  it("saves, loads, and updates one draft per organiser and event", async () => {
    expect(await loadEventBroadcastDraft(ref())).toEqual({ ok: true, data: { draft: null } });

    const first = await saveEventBroadcastDraft(input());
    expect(first.ok).toBe(true);
    const loaded = await loadEventBroadcastDraft(ref());
    expect(loaded).toEqual({ ok: true, data: { draft: {
      subject: "Doors open at six",
      body: "<p>Hello {{name}}</p>",
      design: "minimal",
      statuses: ["CONFIRMED"],
      attendance: "ANY",
      templateId: "update",
      updatedAt: first.ok ? first.data?.updatedAt : "",
    } } });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await saveEventBroadcastDraft(input({ subject: "", body: "", statuses: [], design: "letter", attendance: "NOT_CHECKED_IN", templateId: null }));
    expect(second.ok).toBe(true);
    const rows = await prisma.eventBroadcastDraft.findMany({ where: { eventId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ownerId, subject: "", body: "", statuses: [], design: "letter", attendance: "NOT_CHECKED_IN", templateId: null });
    expect(rows[0]!.updatedAt.getTime()).toBeGreaterThan(new Date(first.ok ? first.data!.updatedAt : 0).getTime());
  });

  it("keeps each organiser's draft private to them", async () => {
    await saveEventBroadcastDraft(input({ subject: "Owner's words" }));
    identity.id = adminId;
    expect(await loadEventBroadcastDraft(ref())).toEqual({ ok: true, data: { draft: null } });
    await saveEventBroadcastDraft(input({ subject: "Admin's words" }));
    expect(await discardEventBroadcastDraft(ref())).toEqual({ ok: true, data: { discarded: true } });

    identity.id = ownerId;
    const owner = await loadEventBroadcastDraft(ref());
    expect(owner.ok && owner.data?.draft?.subject).toBe("Owner's words");
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId } })).toBe(1);
  });

  it("answers another organisation's event as not found and stores nothing", async () => {
    identity.id = ownerBId;
    expect(await saveEventBroadcastDraft(input())).toEqual({ ok: false, error: "You do not have permission to email attendees." });
    expect(await saveEventBroadcastDraft(input({ organisationSlug: orgBSlug }))).toEqual({ ok: false, error: "Event not found." });
    expect(await loadEventBroadcastDraft(ref({ organisationSlug: orgBSlug }))).toEqual({ ok: false, error: "Event not found." });
    expect(await discardEventBroadcastDraft(ref({ organisationSlug: orgBSlug }))).toEqual({ ok: false, error: "Event not found." });

    identity.id = ownerId;
    expect(await saveEventBroadcastDraft(input({ eventId: eventBId }))).toEqual({ ok: false, error: "Event not found." });
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId: { in: [eventId, eventBId] } } })).toBe(0);
  });

  it("refuses a member, who cannot compose broadcasts", async () => {
    identity.id = memberId;
    const denied = { ok: false, error: "You do not have permission to email attendees." };
    expect(await saveEventBroadcastDraft(input())).toEqual(denied);
    expect(await loadEventBroadcastDraft(ref())).toEqual(denied);
    expect(await discardEventBroadcastDraft(ref())).toEqual(denied);
    identity.id = "";
    expect(await saveEventBroadcastDraft(input())).toEqual({ ok: false, error: "You must be signed in." });
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId } })).toBe(0);
  });

  it("sanitises the body exactly as the send path does", async () => {
    const dirty = '<p onclick="steal()">Hi <strong>{{name}}</strong></p><script>alert(1)</script><img src="x" onerror="y"><p><a class="cta evil" href="{{ticketLink}}">Ticket</a> <a href="javascript:alert(1)">bad</a></p>';
    expect((await saveEventBroadcastDraft(input({ body: dirty }))).ok).toBe(true);
    const row = await prisma.eventBroadcastDraft.findUniqueOrThrow({ where: { eventId_userId: { eventId, userId: ownerId } } });
    expect(row.body).not.toMatch(/script|onclick|onerror|<img|javascript:|evil/);
    expect(row.body).toContain("<strong>{{name}}</strong>");
    expect(row.body).toContain('<a class="cta" href="{{ticketLink}}">Ticket</a>');
  });

  it("rejects oversized fields with the send schema's limits", async () => {
    expect((await saveEventBroadcastDraft(input({ subject: "s".repeat(151) }))).ok).toBe(false);
    expect((await saveEventBroadcastDraft(input({ body: "b".repeat(20001) }))).ok).toBe(false);
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId } })).toBe(0);
  });

  it("is removed when its event is deleted, and when its author is", async () => {
    const doomedEvent = await makeEvent(orgAId);
    await saveEventBroadcastDraft(input({ eventId: doomedEvent }));
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId: doomedEvent } })).toBe(1);
    await prisma.event.delete({ where: { id: doomedEvent } });
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId: doomedEvent } })).toBe(0);

    const author = await prisma.user.create({
      data: { email: `drafts-leaver-${suffix}@example.test`, memberships: { create: { organisationId: orgAId, role: MembershipRole.ADMIN } } },
    });
    identity.id = author.id;
    await saveEventBroadcastDraft(input());
    expect(await prisma.eventBroadcastDraft.count({ where: { userId: author.id } })).toBe(1);
    await prisma.user.delete({ where: { id: author.id } });
    expect(await prisma.eventBroadcastDraft.count({ where: { userId: author.id } })).toBe(0);
  });

  it("is cleared by a real send, but not by a test send or another organiser's send", async () => {
    await saveEventBroadcastDraft(input());
    identity.id = adminId;
    await saveEventBroadcastDraft(input({ subject: "Admin draft" }));

    identity.id = ownerId;
    expect((await sendEventBroadcastTest(input())).ok).toBe(true);
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId, userId: ownerId } })).toBe(1);

    const sent = await sendEventBroadcast(input());
    expect(sent.ok).toBe(true);
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId, userId: ownerId } })).toBe(0);
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId, userId: adminId } })).toBe(1);
    expect(await loadEventBroadcastDraft(ref())).toEqual({ ok: true, data: { draft: null } });
  });

  it("keeps the draft when the send fails", async () => {
    await saveEventBroadcastDraft(input({ statuses: ["WAITLISTED"] }));
    expect(await sendEventBroadcast(input({ statuses: ["WAITLISTED"] }))).toEqual({ ok: false, error: "No registrations match the selected audience." });
    expect(await prisma.eventBroadcastDraft.count({ where: { eventId, userId: ownerId } })).toBe(1);
  });

  it("enforces the subject bound in the database too", async () => {
    await expect(prisma.eventBroadcastDraft.create({ data: { eventId, userId: ownerId, subject: "x".repeat(151) } })).rejects.toThrow();
  });
});
