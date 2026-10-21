import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EventPrivacyType, EventStatus, RsvpStatus } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// A distinct client address per call, so the shared per-IP bucket does not
// throttle this suite; the per-account bucket still applies.
const nextIp = vi.hoisted(() => { let n = 0; return () => `198.51.100.${(n++ % 250) + 1}`; });
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": nextIp() }) }));

import { prisma } from "@/lib/db";
import { reacceptRsvpForUser, rejectRsvpForUser } from "@/lib/core/rsvpLifecycle";

const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
const ids = { orgA: "", orgB: "", owner: "", member: "", outsider: "" };
const orgSlugA = `reaccept-a-${suffix}`;
const orgSlugB = `reaccept-b-${suffix}`;
const outboxIds: string[] = [];

async function createUser(name: string) {
  const user = await prisma.user.create({ data: { email: `${name}-${suffix}@example.test`, name, emailVerified: new Date() } });
  return user.id;
}

async function createEvent(organisationId: string, capacity: number | null) {
  return prisma.event.create({ data: {
    organisationId,
    title: `Reaccept ${suffix}`,
    slug: `reaccept-${randomUUID().slice(0, 8)}`,
    startDateTime: new Date("2035-01-01T10:00:00.000Z"),
    endDateTime: new Date("2035-01-01T12:00:00.000Z"),
    timezone: "UTC",
    status: EventStatus.PUBLISHED,
    privacyType: EventPrivacyType.APPROVAL_REQUIRED,
    capacity,
    page: { create: { isPublished: true } },
  } });
}

async function createRsvp(eventId: string, label: string, status: RsvpStatus) {
  return prisma.rSVP.create({ data: { eventId, attendeeKey: `guest:${label}-${suffix}@example.test`, guestEmail: `${label}-${suffix}@example.test`, guestName: label, status } });
}

async function outboxFor(to: string) {
  const messages = await prisma.outboxMessage.findMany({ where: { payload: { path: ["to"], equals: to } }, orderBy: { createdAt: "asc" } });
  outboxIds.push(...messages.map((message) => message.id));
  return messages;
}

describe.sequential("re-accepting a declined registration", () => {
  beforeAll(async () => {
    vi.stubEnv("TRUSTED_PROXY_IP_HEADER", "x-real-ip");
    const [orgA, orgB] = await Promise.all([
      prisma.organisation.create({ data: { name: `Reaccept A ${suffix}`, slug: orgSlugA } }),
      prisma.organisation.create({ data: { name: `Reaccept B ${suffix}`, slug: orgSlugB } }),
    ]);
    ids.orgA = orgA.id;
    ids.orgB = orgB.id;
    ids.owner = await createUser("owner");
    ids.member = await createUser("member");
    ids.outsider = await createUser("outsider");
    await prisma.membership.createMany({ data: [
      { userId: ids.owner, organisationId: orgA.id, role: "OWNER" },
      { userId: ids.member, organisationId: orgA.id, role: "MEMBER" },
      { userId: ids.outsider, organisationId: orgB.id, role: "OWNER" },
    ] });
  });

  afterAll(async () => {
    if (outboxIds.length) await prisma.outboxMessage.deleteMany({ where: { id: { in: outboxIds } } });
    await prisma.auditEvent.deleteMany({ where: { organisationId: { in: [ids.orgA, ids.orgB].filter(Boolean) } } });
    await prisma.organisation.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.owner, ids.member, ids.outsider].filter(Boolean) } } });
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it("confirms a declined guest when there is room, audits it and queues the approval email", async () => {
    const event = await createEvent(ids.orgA, 2);
    const pending = await createRsvp(event.id, "room", RsvpStatus.PENDING_APPROVAL);
    await expect(rejectRsvpForUser(ids.owner, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: pending.id })).resolves.toEqual({ ok: true });

    const result = await reacceptRsvpForUser(ids.owner, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: pending.id });
    expect(result).toEqual({ ok: true, data: { status: RsvpStatus.CONFIRMED } });
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: pending.id } })).resolves.toMatchObject({ status: RsvpStatus.CONFIRMED });

    const audit = await prisma.auditEvent.findMany({ where: { action: "RSVP_REACCEPTED", targetId: pending.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: ids.owner, organisationId: ids.orgA, targetType: "RSVP", metadata: { status: "CONFIRMED" } });

    const messages = await outboxFor(pending.guestEmail!);
    expect(messages.map((message) => message.kind)).toEqual(["rsvp-status", "rsvp-status"]);
    expect(messages[0]!.payload).toMatchObject({ approved: false });
    expect(messages[1]!.payload).toMatchObject({ approved: true, checkInToken: pending.checkInToken, eventTitle: event.title });
  });

  it("waitlists a declined guest when the event is full and queues the waitlist email", async () => {
    const event = await createEvent(ids.orgA, 1);
    await createRsvp(event.id, "holder", RsvpStatus.CONFIRMED);
    const declined = await createRsvp(event.id, "full", RsvpStatus.REJECTED);

    const result = await reacceptRsvpForUser(ids.owner, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: declined.id });
    expect(result).toEqual({ ok: true, data: { status: RsvpStatus.WAITLISTED } });
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: declined.id } })).resolves.toMatchObject({ status: RsvpStatus.WAITLISTED });
    await expect(prisma.rSVP.count({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED } })).resolves.toBe(1);

    const messages = await outboxFor(declined.guestEmail!);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ kind: "rsvp-confirmation", payload: { status: RsvpStatus.WAITLISTED, checkInToken: declined.checkInToken } });
    await expect(prisma.auditEvent.findFirst({ where: { action: "RSVP_REACCEPTED", targetId: declined.id } })).resolves.toMatchObject({ metadata: { status: "WAITLISTED" } });

    // A second attempt is refused: the guest is no longer declined.
    await expect(reacceptRsvpForUser(ids.owner, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: declined.id })).resolves.toEqual({ ok: false, error: "Only declined registrations can be re-accepted." });
  });

  it("never oversells when two organisers re-accept for the last place at once", async () => {
    const event = await createEvent(ids.orgA, 1);
    const [a, b] = await Promise.all([createRsvp(event.id, "race-a", RsvpStatus.REJECTED), createRsvp(event.id, "race-b", RsvpStatus.REJECTED)]);
    const results = await Promise.all([
      reacceptRsvpForUser(ids.owner, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: a.id }),
      reacceptRsvpForUser(ids.owner, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: b.id }),
    ]);
    expect(results.map((result) => (result.ok ? result.data!.status : null)).sort()).toEqual([RsvpStatus.CONFIRMED, RsvpStatus.WAITLISTED].sort());
    await expect(prisma.rSVP.count({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED } })).resolves.toBe(1);
    await outboxFor(a.guestEmail!);
    await outboxFor(b.guestEmail!);
  });

  it("denies an organisation MEMBER without changing the RSVP or sending email", async () => {
    const event = await createEvent(ids.orgA, null);
    const declined = await createRsvp(event.id, "member", RsvpStatus.REJECTED);
    await expect(reacceptRsvpForUser(ids.member, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: declined.id })).resolves.toEqual({ ok: false, error: "You do not have permission to manage attendees." });
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: declined.id } })).resolves.toMatchObject({ status: RsvpStatus.REJECTED });
    await expect(outboxFor(declined.guestEmail!)).resolves.toHaveLength(0);
    await expect(prisma.auditEvent.count({ where: { action: "RSVP_REACCEPTED", targetId: declined.id } })).resolves.toBe(0);
  });

  it("answers NOT_FOUND across organisations", async () => {
    const event = await createEvent(ids.orgA, null);
    const declined = await createRsvp(event.id, "cross", RsvpStatus.REJECTED);
    // An owner of another organisation, using their own slug, cannot reach this event...
    await expect(reacceptRsvpForUser(ids.outsider, { organisationSlug: orgSlugB, eventId: event.id, rsvpId: declined.id })).resolves.toEqual({ ok: false, error: "Event not found." });
    // ...nor this organisation's slug.
    await expect(reacceptRsvpForUser(ids.outsider, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: declined.id })).resolves.toEqual({ ok: false, error: "You do not have permission to manage attendees." });
    // And an RSVP id from another event is not found even for this organisation's owner.
    const other = await createEvent(ids.orgB, null);
    const foreign = await createRsvp(other.id, "foreign", RsvpStatus.REJECTED);
    await expect(reacceptRsvpForUser(ids.owner, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: foreign.id })).resolves.toEqual({ ok: false, error: "RSVP not found." });
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: declined.id } })).resolves.toMatchObject({ status: RsvpStatus.REJECTED });
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: foreign.id } })).resolves.toMatchObject({ status: RsvpStatus.REJECTED });
  });

  it("does not re-accept once the event has ended", async () => {
    const event = await createEvent(ids.orgA, null);
    await prisma.event.update({ where: { id: event.id }, data: { startDateTime: new Date("2020-01-01T10:00:00Z"), endDateTime: new Date("2020-01-01T12:00:00Z") } });
    const declined = await createRsvp(event.id, "ended", RsvpStatus.REJECTED);
    await expect(reacceptRsvpForUser(ids.owner, { organisationSlug: orgSlugA, eventId: event.id, rsvpId: declined.id })).resolves.toEqual({ ok: false, error: "This event is no longer open for approvals." });
    await expect(outboxFor(declined.guestEmail!)).resolves.toHaveLength(0);
  });
});
