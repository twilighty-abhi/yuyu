import { randomUUID } from "node:crypto";
import { EventPrivacyType, EventStatus, MembershipRole, RegistrationMode, RsvpStatus, SoloPolicy, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { cancelRsvpForUser } from "@/lib/core/rsvpCancel";
import { deleteRsvpForUser, updateRsvpRegistrationForUser } from "@/lib/core/rsvpAdmin";
import { countConfirmedForCapacity, countConfirmedUnits } from "@/lib/teamUnits";
import { countConfirmedForEvent } from "@/lib/rsvpCapacity";
import { flushWebhookEmits } from "@/lib/webhooks/emit";
import type { TeamRegistrationIntent } from "@/lib/validators";
import {
  addCrewMemberAsOrganiser,
  getCrewJoinLink,
  joinCrewWithLink,
  listCrewForOrganiser,
  listPublicCrew,
  loadCrewJoinPage,
  moveCrewMember,
  removeCrewMember,
  setCrewJoinLink,
  setCrewMemberVisibility,
  updateCrewMemberAsOrganiser,
  type OrganiserCrewContext,
} from "@/lib/core/crew";

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `crew-${suffix}`;
const otherOrgSlug = `crew-other-${suffix}`;
const startedAt = new Date();
let organisationId = "";
let otherOrganisationId = "";
let organiserId = "";
let otherOrganiserId = "";
let sequence = 0;

type EventOptions = { capacity?: number; registrationMode?: RegistrationMode; status?: EventStatus; ended?: boolean };

async function createEvent(options: EventOptions = {}) {
  const team = options.registrationMode === RegistrationMode.TEAM;
  return prisma.event.create({ data: {
    organisationId,
    title: `Crew ${suffix}`,
    slug: `crew-${suffix}-${randomUUID().slice(0, 8)}`,
    startDateTime: options.ended ? new Date("2020-01-01T10:00:00.000Z") : new Date("2035-01-01T10:00:00.000Z"),
    endDateTime: options.ended ? new Date("2020-01-02T10:00:00.000Z") : new Date("2035-01-02T10:00:00.000Z"),
    timezone: "UTC",
    status: options.status ?? EventStatus.PUBLISHED,
    privacyType: EventPrivacyType.PUBLIC,
    capacity: options.capacity,
    registrationMode: options.registrationMode ?? RegistrationMode.INDIVIDUAL,
    teamMaxSize: team ? 4 : undefined,
    soloPolicy: SoloPolicy.SOLO_ALLOWED,
    page: { create: { isPublished: true } },
  } });
}

function ctxFor(event: Event, organisation = organisationId): OrganiserCrewContext {
  return { organisationId: organisation, eventId: event.id, actorUserId: organiserId };
}

function email(label: string) {
  sequence += 1;
  return `${label}-${sequence}-${suffix}@example.test`;
}

async function register(event: Event, label: string, team?: TeamRegistrationIntent) {
  const guestEmail = email(label);
  const result = await submitRsvpCore(
    { orgSlug, eventSlug: event.slug, guestEmail, name: `${label} Person`, answers: {} },
    { userId: null, ...(team ? { team } : {}) },
  );
  if (!result.ok || !result.data) throw new Error(`registration failed: ${result.ok ? "no data" : result.error}`);
  const rsvp = await prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: result.data.ticketToken } });
  return { rsvp, email: guestEmail };
}

async function addCrew(event: Event, overrides: Record<string, unknown> = {}) {
  const memberEmail = (overrides.email as string | undefined) ?? email("crew");
  const result = await addCrewMemberAsOrganiser(ctxFor(event), { name: "Crew Person", email: memberEmail, foodPreference: "Vegan", role: "Logistics", ...overrides });
  if (!result.ok) throw new Error(`add crew failed: ${result.error}`);
  const member = await prisma.eventCrewMember.findUniqueOrThrow({ where: { id: result.data.id }, include: { rsvp: true } });
  return member;
}

function capacityCount(event: Event) {
  return prisma.$transaction((tx) => countConfirmedForCapacity(tx, event.id, event.registrationMode));
}

describe.sequential("event crew", () => {
  beforeAll(async () => {
    const [org, otherOrg] = await Promise.all([
      prisma.organisation.create({ data: { name: `Crew ${suffix}`, slug: orgSlug } }),
      prisma.organisation.create({ data: { name: `Crew other ${suffix}`, slug: otherOrgSlug } }),
    ]);
    organisationId = org.id;
    otherOrganisationId = otherOrg.id;
    const [user, otherUser] = await Promise.all([
      prisma.user.create({ data: { name: "Crew organiser", email: `organiser-${suffix}@example.test` } }),
      prisma.user.create({ data: { name: "Other organiser", email: `other-organiser-${suffix}@example.test` } }),
    ]);
    organiserId = user.id;
    otherOrganiserId = otherUser.id;
    await prisma.membership.createMany({ data: [
      { userId: organiserId, organisationId, role: MembershipRole.ADMIN },
      { userId: otherOrganiserId, organisationId: otherOrganisationId, role: MembershipRole.ADMIN },
    ] });
  });

  afterAll(async () => {
    await flushWebhookEmits();
    if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
    if (otherOrganisationId) await prisma.organisation.delete({ where: { id: otherOrganisationId } });
    await prisma.user.deleteMany({ where: { id: { in: [organiserId, otherOrganiserId].filter(Boolean) } } });
    await prisma.outboxMessage.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.$disconnect();
  });

  it("issues a confirmed crew ticket with an email and keeps crew out of capacity", async () => {
    const event = await createEvent({ capacity: 1 });
    const first = await addCrew(event);
    const second = await addCrew(event);
    for (const member of [first, second]) {
      expect(member.rsvp).toMatchObject({ eventId: event.id, status: RsvpStatus.CONFIRMED, isCrew: true, teamId: null, guestEmail: member.email });
      expect(member).toMatchObject({ showOnPage: true, joinedViaLink: false });
      const messages = await prisma.outboxMessage.findMany({ where: { kind: "rsvp-confirmation", createdAt: { gte: startedAt } } });
      expect(messages.some((message) => (message.payload as { checkInToken?: string }).checkInToken === member.rsvp.checkInToken)).toBe(true);
    }
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);

    await expect(countConfirmedForEvent(event.id)).resolves.toBe(0);
    await expect(capacityCount(event)).resolves.toBe(0);

    const attendee = await register(event, "attendee");
    const late = await register(event, "late");
    expect(attendee.rsvp.status).toBe(RsvpStatus.CONFIRMED);
    expect(late.rsvp.status).toBe(RsvpStatus.WAITLISTED);
    await expect(capacityCount(event)).resolves.toBe(1);
    // Crew still count in the headcount of people going.
    await expect(prisma.rSVP.count({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED } })).resolves.toBe(3);

    const listed = await listCrewForOrganiser(ctxFor(event));
    expect(listed.members.map((member) => member.id)).toEqual([first.id, second.id]);
    expect(listed.food).toEqual([{ label: "Vegan", count: 2 }]);
  });

  it("does not count crew as units on a TEAM event", async () => {
    const event = await createEvent({ capacity: 1, registrationMode: RegistrationMode.TEAM });
    await addCrew(event);
    await expect(prisma.$transaction((tx) => countConfirmedUnits(tx, event.id))).resolves.toBe(0);
    const leader = await register(event, "leader", { mode: "create", name: `Owls ${suffix}` });
    expect(leader.rsvp.status).toBe(RsvpStatus.CONFIRMED);
    await expect(prisma.$transaction((tx) => countConfirmedUnits(tx, event.id))).resolves.toBe(1);
    await expect(capacityCount(event)).resolves.toBe(1);
  });

  it("turns a solo registration into a crew ticket, keeping its token and freeing its place", async () => {
    const event = await createEvent({ capacity: 1 });
    const attendee = await register(event, "convert");
    const waiting = await register(event, "waiting");
    expect([attendee.rsvp.status, waiting.rsvp.status]).toEqual([RsvpStatus.CONFIRMED, RsvpStatus.WAITLISTED]);

    const member = await addCrew(event, { email: attendee.email.toUpperCase() });
    expect(member.email).toBe(attendee.email);
    expect(member.rsvpId).toBe(attendee.rsvp.id);
    expect(member.rsvp).toMatchObject({ checkInToken: attendee.rsvp.checkInToken, isCrew: true, status: RsvpStatus.CONFIRMED });
    await expect(prisma.rSVP.count({ where: { eventId: event.id } })).resolves.toBe(2);
    await expect(capacityCount(event)).resolves.toBe(0);
  });

  it("converts a waitlisted registration into a confirmed crew ticket", async () => {
    const event = await createEvent({ capacity: 1 });
    await register(event, "first");
    const waiting = await register(event, "waiting");
    const member = await addCrew(event, { email: waiting.email });
    expect(member.rsvp).toMatchObject({ id: waiting.rsvp.id, status: RsvpStatus.CONFIRMED, isCrew: true });
    await expect(capacityCount(event)).resolves.toBe(1);
  });

  it("refuses a team member", async () => {
    const event = await createEvent({ registrationMode: RegistrationMode.TEAM });
    const leader = await register(event, "leader", { mode: "create", name: `Larks ${suffix}` });
    const result = await addCrewMemberAsOrganiser(ctxFor(event), { name: "Leader", email: leader.email });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("registered in a team") });
    await expect(prisma.eventCrewMember.count({ where: { eventId: event.id } })).resolves.toBe(0);
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: leader.rsvp.id } })).resolves.toMatchObject({ isCrew: false, teamId: leader.rsvp.teamId });
  });

  it("refuses a duplicate email for organisers and answers a link duplicate without a second row", async () => {
    const event = await createEvent();
    const member = await addCrew(event);
    await expect(addCrewMemberAsOrganiser(ctxFor(event), { name: "Again", email: member.email.toUpperCase() })).resolves.toEqual({ ok: false, error: "This email is already on the crew." });

    const link = await setCrewJoinLink(ctxFor(event), "create");
    if (!link.ok || !link.data) throw new Error("link not created");
    await expect(joinCrewWithLink(link.data.token, { name: "Again", email: member.email })).resolves.toEqual({ ok: true, data: { eventTitle: event.title } });
    await expect(prisma.eventCrewMember.count({ where: { eventId: event.id } })).resolves.toBe(1);
    await expect(prisma.rSVP.count({ where: { eventId: event.id } })).resolves.toBe(1);
  });

  it("never converts a registration through the crew link, and answers the same way", async () => {
    const event = await createEvent({ capacity: 1 });
    await register(event, "first");
    const waiting = await register(event, "waiting");
    const link = await setCrewJoinLink(ctxFor(event), "create");
    if (!link.ok || !link.data) throw new Error("link not created");
    await expect(joinCrewWithLink(link.data.token, { name: "Sneaky", email: waiting.email })).resolves.toEqual({ ok: true, data: { eventTitle: event.title } });
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: waiting.rsvp.id } })).resolves.toMatchObject({ status: RsvpStatus.WAITLISTED, isCrew: false });
    await expect(prisma.eventCrewMember.count({ where: { eventId: event.id } })).resolves.toBe(0);

    const teamEvent = await createEvent({ registrationMode: RegistrationMode.TEAM });
    const leader = await register(teamEvent, "leader", { mode: "create", name: `Kites ${suffix}` });
    const teamLink = await setCrewJoinLink(ctxFor(teamEvent), "create");
    if (!teamLink.ok || !teamLink.data) throw new Error("link not created");
    // Same answer as a fresh sign-up: the link must not reveal that this email is in a team.
    await expect(joinCrewWithLink(teamLink.data.token, { name: "Leader", email: leader.email })).resolves.toEqual({ ok: true, data: { eventTitle: teamEvent.title } });
    await expect(prisma.eventCrewMember.count({ where: { eventId: teamEvent.id } })).resolves.toBe(0);
  });

  it("creates, keeps, rotates and disables the join link", async () => {
    const event = await createEvent();
    await expect(getCrewJoinLink(ctxFor(event))).resolves.toBeNull();
    const created = await setCrewJoinLink(ctxFor(event), "create");
    if (!created.ok || !created.data) throw new Error("link not created");
    const original = created.data.token;
    await expect(setCrewJoinLink(ctxFor(event), "create")).resolves.toEqual({ ok: true, data: { token: original } });
    await expect(getCrewJoinLink(ctxFor(event))).resolves.toMatchObject({ token: original });
    await expect(loadCrewJoinPage(original)).resolves.toMatchObject({ eventId: event.id, organisationId, eventTitle: event.title, open: true });

    const rotated = await setCrewJoinLink(ctxFor(event), "rotate");
    if (!rotated.ok || !rotated.data) throw new Error("link not rotated");
    expect(rotated.data.token).not.toBe(original);
    await expect(loadCrewJoinPage(original)).resolves.toBeNull();
    await expect(joinCrewWithLink(original, { name: "Old link", email: email("old") })).resolves.toEqual({ ok: false, error: expect.stringContaining("no longer valid") });
    await expect(loadCrewJoinPage(rotated.data.token)).resolves.not.toBeNull();

    await expect(setCrewJoinLink(ctxFor(event), "disable")).resolves.toEqual({ ok: true, data: null });
    await expect(loadCrewJoinPage(rotated.data.token)).resolves.toBeNull();
    await expect(getCrewJoinLink(ctxFor(event))).resolves.toBeNull();
    await expect(prisma.eventCrewMember.count({ where: { eventId: event.id } })).resolves.toBe(0);

    await expect(loadCrewJoinPage("not a token")).resolves.toBeNull();
    await expect(loadCrewJoinPage("a".repeat(43))).resolves.toBeNull();
  });

  it("adds link sign-ups hidden until reviewed, with a ticket", async () => {
    const event = await createEvent();
    const link = await setCrewJoinLink(ctxFor(event), "create");
    if (!link.ok || !link.data) throw new Error("link not created");
    const memberEmail = email("volunteer");
    await expect(joinCrewWithLink(link.data.token, { name: " Volunteer ", email: memberEmail.toUpperCase(), foodPreference: "Jain", role: "Stage" })).resolves.toEqual({ ok: true, data: { eventTitle: event.title } });
    const member = await prisma.eventCrewMember.findFirstOrThrow({ where: { eventId: event.id }, include: { rsvp: true } });
    expect(member).toMatchObject({ name: "Volunteer", email: memberEmail, showOnPage: false, joinedViaLink: true, foodPreference: "Jain", role: "Stage" });
    expect(member.rsvp).toMatchObject({ status: RsvpStatus.CONFIRMED, isCrew: true });
    await expect(listPublicCrew(event.id)).resolves.toEqual([]);

    // The public form cannot choose its own visibility.
    await expect(joinCrewWithLink(link.data.token, { name: "Pushy", email: email("pushy"), showOnPage: true })).resolves.toMatchObject({ ok: false });
    await expect(prisma.eventCrewMember.count({ where: { eventId: event.id } })).resolves.toBe(1);

    await expect(setCrewMemberVisibility(ctxFor(event), member.id, true)).resolves.toEqual({ ok: true, data: undefined });
    await expect(listPublicCrew(event.id)).resolves.toHaveLength(1);
  });

  it("refuses link sign-ups for cancelled and ended events", async () => {
    for (const options of [{ status: EventStatus.CANCELLED }, { ended: true }] satisfies EventOptions[]) {
      const event = await createEvent(options);
      const link = await setCrewJoinLink(ctxFor(event), "create");
      if (!link.ok || !link.data) throw new Error("link not created");
      await expect(loadCrewJoinPage(link.data.token)).resolves.toMatchObject({ open: false });
      await expect(joinCrewWithLink(link.data.token, { name: "Late", email: email("late") })).resolves.toEqual({ ok: false, error: "This event is no longer taking crew sign-ups." });
      await expect(prisma.eventCrewMember.count({ where: { eventId: event.id } })).resolves.toBe(0);
    }
  });

  it("keeps another organisation out", async () => {
    const event = await createEvent();
    const member = await addCrew(event);
    await setCrewJoinLink(ctxFor(event), "create");
    const foreign = ctxFor(event, otherOrganisationId);

    await expect(listCrewForOrganiser(foreign)).resolves.toEqual({ members: [], food: [] });
    await expect(getCrewJoinLink(foreign)).resolves.toBeNull();
    await expect(addCrewMemberAsOrganiser(foreign, { name: "Intruder", email: email("intruder") })).resolves.toEqual({ ok: false, error: "Event not found." });
    await expect(updateCrewMemberAsOrganiser(foreign, member.id, { name: "Changed", email: member.email })).resolves.toEqual({ ok: false, error: "Event not found." });
    await expect(setCrewMemberVisibility(foreign, member.id, false)).resolves.toEqual({ ok: false, error: "Crew member not found." });
    await expect(removeCrewMember(foreign, member.id)).resolves.toEqual({ ok: false, error: "Crew member not found." });
    await expect(moveCrewMember(foreign, member.id, 1)).resolves.toEqual({ ok: false, error: "Crew member not found." });
    await expect(setCrewJoinLink(foreign, "rotate")).resolves.toEqual({ ok: false, error: "Event not found." });
    await expect(setCrewJoinLink(foreign, "disable")).resolves.toEqual({ ok: false, error: "Event not found." });

    // A member id from another event in the right organisation is not found either.
    const otherEvent = await createEvent();
    await expect(updateCrewMemberAsOrganiser(ctxFor(otherEvent), member.id, { name: "Changed", email: member.email })).resolves.toEqual({ ok: false, error: "Crew member not found." });

    await expect(prisma.eventCrewMember.findUniqueOrThrow({ where: { id: member.id } })).resolves.toMatchObject({ name: member.name, showOnPage: true });
    await expect(getCrewJoinLink(ctxFor(event))).resolves.not.toBeNull();
  });

  it("updates the profile and the guest ticket together, and reorders", async () => {
    const event = await createEvent();
    const first = await addCrew(event);
    const second = await addCrew(event);
    const newEmail = email("renamed");
    await expect(updateCrewMemberAsOrganiser(ctxFor(event), first.id, { name: "Renamed", email: newEmail, role: "Host", showOnPage: false })).resolves.toEqual({ ok: true, data: undefined });
    const updated = await prisma.eventCrewMember.findUniqueOrThrow({ where: { id: first.id }, include: { rsvp: true } });
    expect(updated).toMatchObject({ name: "Renamed", email: newEmail, role: "Host", showOnPage: false });
    expect(updated.rsvp).toMatchObject({ guestName: "Renamed", guestEmail: newEmail, attendeeKey: `guest:${newEmail}`, checkInToken: first.rsvp.checkInToken });
    await expect(updateCrewMemberAsOrganiser(ctxFor(event), first.id, { name: "Clash", email: second.email })).resolves.toMatchObject({ ok: false });

    await expect(moveCrewMember(ctxFor(event), second.id, -1)).resolves.toEqual({ ok: true, data: undefined });
    const { members } = await listCrewForOrganiser(ctxFor(event));
    expect(members.map((member) => member.id)).toEqual([second.id, first.id]);
  });

  it("keeps crew tickets out of the guest cancel, edit and delete flows", async () => {
    const event = await createEvent();
    const member = await addCrew(event);
    const target = { organisationSlug: orgSlug, eventId: event.id, rsvpId: member.rsvpId };

    await expect(cancelRsvpForUser(null, { checkInToken: member.rsvp.checkInToken })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("crew") });
    await expect(deleteRsvpForUser(organiserId, target)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("crew") });
    await expect(updateRsvpRegistrationForUser(organiserId, { ...target, name: "Edited" })).resolves.toMatchObject({ ok: false, error: expect.stringContaining("crew") });
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: member.rsvpId } })).resolves.toMatchObject({ status: RsvpStatus.CONFIRMED, isCrew: true, guestName: member.name });

    await expect(removeCrewMember(ctxFor(event), member.id)).resolves.toEqual({ ok: true, data: { name: member.name } });
    await expect(prisma.rSVP.findUnique({ where: { id: member.rsvpId } })).resolves.toBeNull();
    await expect(prisma.eventCrewMember.findUnique({ where: { id: member.id } })).resolves.toBeNull();
  });

  it("cascades the crew row when its ticket is deleted", async () => {
    const event = await createEvent();
    const member = await addCrew(event);
    await prisma.rSVP.delete({ where: { id: member.rsvpId } });
    await expect(prisma.eventCrewMember.findUnique({ where: { id: member.id } })).resolves.toBeNull();
  });

  it("enforces the crew ticket shape in the database", async () => {
    const event = await createEvent();
    await expect(prisma.rSVP.create({ data: { eventId: event.id, guestEmail: email("bad"), attendeeKey: `guest:${email("bad")}`, status: RsvpStatus.WAITLISTED, isCrew: true } })).rejects.toThrow(/RSVP_crew_shape/);
    const member = await addCrew(event);
    await expect(prisma.rSVP.update({ where: { id: member.rsvpId }, data: { status: RsvpStatus.PENDING_APPROVAL } })).rejects.toThrow(/RSVP_crew_shape/);

    const teamEvent = await createEvent({ registrationMode: RegistrationMode.TEAM });
    const leader = await register(teamEvent, "leader", { mode: "create", name: `Wrens ${suffix}` });
    await expect(prisma.rSVP.update({ where: { id: leader.rsvp.id }, data: { isCrew: true } })).rejects.toThrow(/RSVP_crew_shape/);
  });

  it("lists only visible crew publicly, without private fields", async () => {
    const event = await createEvent();
    const shown = await addCrew(event, { bio: "Runs the stage", linkedinUrl: "https://www.linkedin.com/in/someone" });
    await addCrew(event, { showOnPage: false });
    const crew = await listPublicCrew(event.id);
    expect(crew).toEqual([{ id: shown.id, name: shown.name, role: "Logistics", bio: "Runs the stage", photoUrl: null, linkedinUrl: "https://www.linkedin.com/in/someone" }]);
    for (const card of crew) {
      expect(Object.keys(card).sort()).toEqual(["bio", "id", "linkedinUrl", "name", "photoUrl", "role"]);
      expect(JSON.stringify(card)).not.toContain(shown.email);
      expect(JSON.stringify(card)).not.toContain(shown.rsvp.checkInToken);
    }
  });
});
