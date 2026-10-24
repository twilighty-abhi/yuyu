import { randomUUID } from "node:crypto";
import { EventPermission, EventPrivacyType, EventStatus, MembershipRole, RsvpStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Server-side boundaries for event co-organisers (docs/PERMISSIONS.md):
 * deleting, cloning, renaming, publishing, short links and collaborator
 * management stay with organisation owners/admins whatever the grant, while
 * MANAGE_INVITATIONS and MANAGE_REGISTRATIONS reach exactly their own actions.
 */

const identity = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => (identity.id ? { user: { id: identity.id } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/outboxWorker", () => ({ startOutboxWorker: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { cloneEvent, deleteEvent, publishEvent, updateEventSlug } from "@/app/actions/event";
import {
  cancelEventCollaboratorInvite,
  createEventCollaboratorInvite,
  revokeEventCollaborator,
  updateEventCollaboratorPermissions,
} from "@/app/actions/event-collaborators";
import { createEventShortLink } from "@/app/actions/shortLink";
import { deleteEventSeries } from "@/app/actions/series";
import { addEventInvite, addSeriesInvite, removeEventInvite } from "@/app/actions/invites";
import { approveRsvp, reacceptRsvp } from "@/app/actions/rsvp-lifecycle";
import { deleteRsvp, restoreRsvp } from "@/app/actions/rsvp-admin";

const suffix = randomUUID().replace(/-/g, "");
const ALL = Object.values(EventPermission);
const SINGLE: EventPermission[][] = ALL.map((permission) => [permission]);
const label = (grant: EventPermission[]) => (grant.length === ALL.length ? "all grants" : grant.join("+"));

let orgId = "";
let orgSlug = "";
let ownerId = "";
let memberId = "";
let eventId = "";
let eventSlug = "";
let seriesId = "";
let instanceId = "";
let pendingInviteId = "";
const userIds: string[] = [];
/** Collaborator user per grant set, on the standalone event. */
const eventCollaborators = new Map<string, { userId: string; collaboratorId: string }>();
/** Collaborator user per grant set, on the series. */
const seriesCollaborators = new Map<string, string>();

async function user(name: string, role?: MembershipRole) {
  const created = await prisma.user.create({ data: { email: `${name}-${suffix}@example.test`, emailVerified: new Date() } });
  userIds.push(created.id);
  if (role) await prisma.membership.create({ data: { userId: created.id, organisationId: orgId, role } });
  return created.id;
}

async function pendingRsvp(target: { eventId: string } | { eventInstanceId: string }) {
  const key = randomUUID().slice(0, 8);
  return prisma.rSVP.create({
    data: { ...target, attendeeKey: `guest:${key}-${suffix}@example.test`, guestEmail: `${key}-${suffix}@example.test`, guestName: "Pending guest", status: RsvpStatus.PENDING_APPROVAL },
  });
}

const as = (id: string) => {
  identity.id = id;
};

beforeAll(async () => {
  orgSlug = `collab-perms-${suffix}`;
  orgId = (await prisma.organisation.create({ data: { name: "Collaborator permissions", slug: orgSlug } })).id;
  ownerId = await user("owner", MembershipRole.OWNER);
  memberId = await user("member", MembershipRole.MEMBER);
  eventSlug = `collab-event-${suffix}`;
  const event = await prisma.event.create({
    data: {
      organisationId: orgId,
      title: "Co-organised event",
      slug: eventSlug,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-01T12:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.DRAFT,
      privacyType: EventPrivacyType.APPROVAL_REQUIRED,
      page: { create: { isPublished: false } },
    },
  });
  eventId = event.id;
  const series = await prisma.eventSeries.create({
    data: { organisationId: orgId, title: "Co-organised series", slug: `collab-series-${suffix}`, recurrenceRule: "FREQ=WEEKLY;COUNT=2", timezone: "UTC", privacyType: EventPrivacyType.APPROVAL_REQUIRED },
  });
  seriesId = series.id;
  instanceId = (await prisma.eventInstance.create({ data: { eventSeriesId: seriesId, startDateTime: new Date("2035-02-01T10:00:00.000Z"), endDateTime: new Date("2035-02-01T11:00:00.000Z") } })).id;

  for (const grant of [...SINGLE, ALL]) {
    const eventUser = await user(`event-${label(grant).toLowerCase().replace(/[^a-z]+/g, "-")}`);
    const collaborator = await prisma.eventCollaborator.create({ data: { eventId, userId: eventUser, permissions: grant } });
    eventCollaborators.set(label(grant), { userId: eventUser, collaboratorId: collaborator.id });
    const seriesUser = await user(`series-${label(grant).toLowerCase().replace(/[^a-z]+/g, "-")}`);
    await prisma.eventCollaborator.create({ data: { eventSeriesId: seriesId, userId: seriesUser, permissions: grant } });
    seriesCollaborators.set(label(grant), seriesUser);
  }
  pendingInviteId = (await prisma.eventCollaboratorInvite.create({
    data: { eventId, email: `pending-${suffix}@example.test`, tokenHash: `hash-${suffix}`, permissions: [EventPermission.CHECK_IN], createdByUserId: ownerId, expiresAt: new Date(Date.now() + 86_400_000) },
  })).id;
});

afterAll(async () => {
  if (orgId) await prisma.organisation.delete({ where: { id: orgId } });
  await prisma.$executeRaw`DELETE FROM "OutboxMessage" WHERE "payload"->>'to' LIKE ${`%${suffix}@example.test`}`;
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

const everyCollaborator = () => [...SINGLE, ALL].map((grant) => [label(grant), eventCollaborators.get(label(grant))!.userId] as const);

describe("organisation-level event operations stay with owners and admins", () => {
  it.each([...SINGLE, ALL].map(label))("denies delete, clone and address changes to a collaborator with %s", async (name) => {
    as(eventCollaborators.get(name)!.userId);
    const before = await prisma.event.count({ where: { organisationId: orgId } });
    expect(await deleteEvent({ organisationSlug: orgSlug, eventId })).toMatchObject({ ok: false });
    expect(await cloneEvent({ organisationSlug: orgSlug, eventId })).toMatchObject({ ok: false });
    expect(await updateEventSlug({ organisationSlug: orgSlug, eventId, slug: `renamed-${suffix}` })).toMatchObject({ ok: false });
    expect(await prisma.event.count({ where: { organisationId: orgId } })).toBe(before);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).slug).toBe(eventSlug);
  });

  it("denies delete and clone to an organisation member", async () => {
    as(memberId);
    expect(await deleteEvent({ organisationSlug: orgSlug, eventId })).toMatchObject({ ok: false });
    expect(await cloneEvent({ organisationSlug: orgSlug, eventId })).toMatchObject({ ok: false });
    expect(await prisma.event.findUnique({ where: { id: eventId } })).not.toBeNull();
  });

  it("denies publishing and short links to a collaborator with every grant", async () => {
    as(eventCollaborators.get("all grants")!.userId);
    expect(await publishEvent({ organisationSlug: orgSlug, eventSlug })).toMatchObject({ ok: false });
    expect(await createEventShortLink({ organisationSlug: orgSlug, eventId })).toMatchObject({ ok: false });
    expect(await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, shortCode: true } })).toEqual({ status: EventStatus.DRAFT, shortCode: null });
  });

  it("denies deleting a series to a series collaborator with every grant", async () => {
    as(seriesCollaborators.get("all grants")!);
    expect(await deleteEventSeries({ organisationSlug: orgSlug, eventSeriesId: seriesId })).toMatchObject({ ok: false });
    expect(await prisma.eventSeries.findUnique({ where: { id: seriesId } })).not.toBeNull();
  });
});

describe("collaborator management stays with owners and admins", () => {
  it.each([...SINGLE, ALL].map(label))("denies a collaborator with %s every collaborator action", async (name) => {
    const self = eventCollaborators.get(name)!;
    const other = eventCollaborators.get("CHECK_IN")!;
    as(self.userId);
    expect(await createEventCollaboratorInvite({ organisationSlug: orgSlug, eventId, email: `friend-${suffix}@example.test`, permissions: ALL })).toMatchObject({ ok: false });
    // Not even to widen their own grant.
    expect(await updateEventCollaboratorPermissions({ organisationSlug: orgSlug, eventId, collaboratorId: self.collaboratorId, permissions: ALL })).toMatchObject({ ok: false });
    expect(await revokeEventCollaborator({ organisationSlug: orgSlug, eventId, collaboratorId: other.collaboratorId })).toMatchObject({ ok: false });
    expect(await cancelEventCollaboratorInvite({ organisationSlug: orgSlug, eventId, inviteId: pendingInviteId })).toMatchObject({ ok: false });
  });

  it("left every grant, collaborator and invite as it was", async () => {
    expect(await prisma.eventCollaboratorInvite.count({ where: { eventId } })).toBe(1);
    expect(await prisma.eventCollaborator.count({ where: { eventId } })).toBe(SINGLE.length + 1);
    const checkInOnly = await prisma.eventCollaborator.findUniqueOrThrow({ where: { id: eventCollaborators.get("CHECK_IN")!.collaboratorId } });
    expect(checkInOnly.permissions).toEqual([EventPermission.CHECK_IN]);
  });

  it("still lets the owner manage collaborators", async () => {
    as(ownerId);
    expect(await cancelEventCollaboratorInvite({ organisationSlug: orgSlug, eventId, inviteId: pendingInviteId })).toEqual({ ok: true });
  });
});

describe("each grant reaches its own actions", () => {
  it("lets MANAGE_INVITATIONS (alone or with every grant) manage event invites, and nobody else", async () => {
    for (const [name, userId] of everyCollaborator()) {
      as(userId);
      const email = `invitee-${name.toLowerCase().replace(/[^a-z]+/g, "-")}-${suffix}@example.test`;
      const result = await addEventInvite({ organisationSlug: orgSlug, eventId, email });
      const allowed = name === "MANAGE_INVITATIONS" || name === "all grants";
      expect(result.ok, name).toBe(allowed);
      if (allowed) {
        const invite = await prisma.eventInvite.findFirstOrThrow({ where: { eventId, email } });
        expect(await removeEventInvite({ organisationSlug: orgSlug, eventId, inviteId: invite.id })).toEqual({ ok: true });
      }
    }
    as(memberId);
    expect(await addEventInvite({ organisationSlug: orgSlug, eventId, email: `member-invitee-${suffix}@example.test` })).toMatchObject({ ok: false });
  });

  it("applies a series MANAGE_INVITATIONS grant to series invites only", async () => {
    as(seriesCollaborators.get("MANAGE_INVITATIONS")!);
    expect(await addSeriesInvite({ organisationSlug: orgSlug, eventSeriesId: seriesId, email: `series-invitee-${suffix}@example.test` })).toEqual({ ok: true });
    expect(await addEventInvite({ organisationSlug: orgSlug, eventId, email: `wrong-target-${suffix}@example.test` })).toMatchObject({ ok: false });
    as(seriesCollaborators.get("CHECK_IN")!);
    expect(await addSeriesInvite({ organisationSlug: orgSlug, eventSeriesId: seriesId, email: `series-denied-${suffix}@example.test` })).toMatchObject({ ok: false });
  });

  it("lets MANAGE_REGISTRATIONS (alone or with every grant) approve and remove RSVPs, and nobody else", async () => {
    // Approval needs a live event; the organisation-level checks above ran on the draft.
    await prisma.event.update({ where: { id: eventId }, data: { status: EventStatus.PUBLISHED, page: { update: { isPublished: true } } } });
    await prisma.eventSeries.update({ where: { id: seriesId }, data: { status: EventStatus.PUBLISHED } });
    for (const [name, userId] of everyCollaborator()) {
      const rsvp = await pendingRsvp({ eventId });
      as(userId);
      const allowed = name === "MANAGE_REGISTRATIONS" || name === "all grants";
      expect((await approveRsvp({ organisationSlug: orgSlug, eventId, rsvpId: rsvp.id })).ok, name).toBe(allowed);
      const status = (await prisma.rSVP.findUniqueOrThrow({ where: { id: rsvp.id } })).status;
      expect(status, name).toBe(allowed ? RsvpStatus.CONFIRMED : RsvpStatus.PENDING_APPROVAL);
      const removed = await deleteRsvp({ organisationSlug: orgSlug, eventId, rsvpId: rsvp.id });
      expect(removed.ok, name).toBe(allowed);
      if (removed.ok) expect(await restoreRsvp({ organisationSlug: orgSlug, undoId: removed.data!.undoId })).toEqual({ ok: true });
    }
    const rsvp = await pendingRsvp({ eventId });
    as(memberId);
    expect(await approveRsvp({ organisationSlug: orgSlug, eventId, rsvpId: rsvp.id })).toMatchObject({ ok: false });
  });

  it("lets MANAGE_REGISTRATIONS (alone or with every grant) re-accept a declined RSVP, and nobody else", async () => {
    for (const [name, userId] of everyCollaborator()) {
      const rsvp = await prisma.rSVP.update({ where: { id: (await pendingRsvp({ eventId })).id }, data: { status: RsvpStatus.REJECTED } });
      as(userId);
      const allowed = name === "MANAGE_REGISTRATIONS" || name === "all grants";
      expect((await reacceptRsvp({ organisationSlug: orgSlug, eventId, rsvpId: rsvp.id })).ok, name).toBe(allowed);
      const status = (await prisma.rSVP.findUniqueOrThrow({ where: { id: rsvp.id } })).status;
      expect(status, name).toBe(allowed ? RsvpStatus.CONFIRMED : RsvpStatus.REJECTED);
    }
    const declined = await prisma.rSVP.update({ where: { id: (await pendingRsvp({ eventId })).id }, data: { status: RsvpStatus.REJECTED } });
    as(memberId);
    expect(await reacceptRsvp({ organisationSlug: orgSlug, eventId, rsvpId: declined.id })).toMatchObject({ ok: false });
  });

  it("applies a series MANAGE_REGISTRATIONS grant to that series' occurrences only", async () => {
    const occurrenceRsvp = await pendingRsvp({ eventInstanceId: instanceId });
    as(eventCollaborators.get("MANAGE_REGISTRATIONS")!.userId);
    expect(await approveRsvp({ organisationSlug: orgSlug, eventInstanceId: instanceId, rsvpId: occurrenceRsvp.id })).toMatchObject({ ok: false });
    as(seriesCollaborators.get("MANAGE_REGISTRATIONS")!);
    expect(await approveRsvp({ organisationSlug: orgSlug, eventInstanceId: instanceId, rsvpId: occurrenceRsvp.id })).toEqual({ ok: true });
    const eventRsvp = await pendingRsvp({ eventId });
    expect(await approveRsvp({ organisationSlug: orgSlug, eventId, rsvpId: eventRsvp.id })).toMatchObject({ ok: false });
  });
});
