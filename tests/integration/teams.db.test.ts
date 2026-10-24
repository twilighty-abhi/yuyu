import { randomUUID } from "node:crypto";
import {
  EventPrivacyType,
  EventStatus,
  MembershipRole,
  RegistrationMode,
  RsvpStatus,
  SoloPolicy,
  TeamJoinRequestStatus,
  type Event,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { submitRsvpCore } from "@/lib/rsvpCore";
import { cancelRsvpForUser } from "@/lib/core/rsvpCancel";
import { approveRsvpForUser } from "@/lib/core/rsvpLifecycle";
import { deleteRsvpForUser, restoreRsvpForUser } from "@/lib/core/rsvpAdmin";
import { countConfirmedUnits } from "@/lib/teamUnits";
import { hashTeamManageToken } from "@/lib/teamToken";
import {
  addTeamMemberByLeader,
  createJoinRequest,
  disbandTeam,
  leaveTeam,
  listSeekersForLeader,
  loadJoinPageTeam,
  loadTeamPage,
  organiserDeleteTeam,
  organiserMoveMember,
  organiserRenameTeam,
  regenerateManageToken,
  removeTeamMember,
  renameTeam,
  resolveOrganiserEvent,
  resolveRsvpByTicketToken,
  resolveTeamByManageToken,
  respondToJoinRequest,
  setLookingForMembers,
  transferLeadership,
  transitionTeamStatus,
  type OrganiserEventContext,
  type TeamLeaderAuth,
} from "@/lib/core/teams";
import type { TeamRegistrationIntent } from "@/lib/validators";

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `teams-${suffix}`;
const otherOrgSlug = `teams-other-${suffix}`;
const startedAt = new Date();
let organisationId = "";
let otherOrganisationId = "";
let organiserId = "";
let otherOrganiserId = "";
let sequence = 0;

type EventOptions = {
  capacity?: number;
  privacyType?: EventPrivacyType;
  registrationMode?: RegistrationMode;
  teamMinSize?: number;
  teamMaxSize?: number;
  soloPolicy?: SoloPolicy;
  organisation?: string;
};

async function createEvent(options: EventOptions = {}) {
  const team = (options.registrationMode ?? RegistrationMode.TEAM) === RegistrationMode.TEAM;
  return prisma.event.create({ data: {
    organisationId: options.organisation ?? organisationId,
    title: `Teams ${suffix}`,
    slug: `teams-${suffix}-${randomUUID().slice(0, 8)}`,
    startDateTime: new Date("2035-01-01T10:00:00.000Z"),
    endDateTime: new Date("2035-01-02T10:00:00.000Z"),
    timezone: "UTC",
    status: EventStatus.PUBLISHED,
    privacyType: options.privacyType ?? EventPrivacyType.PUBLIC,
    capacity: options.capacity,
    registrationMode: options.registrationMode ?? RegistrationMode.TEAM,
    teamMinSize: team ? options.teamMinSize : undefined,
    teamMaxSize: team ? options.teamMaxSize ?? 4 : undefined,
    soloPolicy: options.soloPolicy ?? SoloPolicy.SOLO_ALLOWED,
    page: { create: { isPublished: true } },
  } });
}

function slugFor(event: Event) {
  return event.organisationId === otherOrganisationId ? otherOrgSlug : orgSlug;
}

async function register(event: Event, label: string, team?: TeamRegistrationIntent) {
  sequence += 1;
  const guestEmail = `${label}-${sequence}-${suffix}@example.test`;
  const result = await submitRsvpCore(
    { orgSlug: slugFor(event), eventSlug: event.slug, guestEmail, name: `${label} Person`, answers: {} },
    { userId: null, ...(team ? { team } : {}) },
  );
  return { result, guestEmail };
}

type Registered = { rsvpId: string; ticketToken: string; email: string; status: RsvpStatus; teamId: string | null };

async function registerOk(event: Event, label: string, team?: TeamRegistrationIntent): Promise<Registered> {
  const { result, guestEmail } = await register(event, label, team);
  if (!result.ok || !result.data) throw new Error(`registration failed: ${result.ok ? "no data" : result.error}`);
  const rsvp = await prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: result.data.ticketToken } });
  return { rsvpId: rsvp.id, ticketToken: result.data.ticketToken, email: guestEmail, status: rsvp.status, teamId: rsvp.teamId };
}

async function createTeam(event: Event, name: string) {
  const leader = await registerOk(event, "leader", { mode: "create", name });
  if (!leader.teamId) throw new Error("team was not created");
  const team = await prisma.team.findUniqueOrThrow({ where: { id: leader.teamId } });
  return { leader, team, manageToken: await currentManageToken(team.id) };
}

async function joinTeam(event: Event, teamId: string, label = "member") {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
  return registerOk(event, label, { mode: "join", joinToken: team.joinToken });
}

/** The raw management token is only ever in the leader's outbox email; pick the one that is still valid. */
async function currentManageToken(teamId: string) {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { manageTokenHash: true } });
  const messages = await prisma.outboxMessage.findMany({
    where: { kind: "team-created", payload: { path: ["teamId"], equals: teamId } },
  });
  const token = messages
    .map((message) => (message.payload as { manageToken?: string }).manageToken)
    .find((raw) => raw && hashTeamManageToken(raw) === team.manageTokenHash);
  if (!token) throw new Error("no valid management token queued");
  return token;
}

async function leaderAuth(teamId: string): Promise<TeamLeaderAuth> {
  const auth = await resolveTeamByManageToken(await currentManageToken(teamId));
  if (!auth) throw new Error("management token did not resolve");
  return auth;
}

async function organiser(event: Event): Promise<OrganiserEventContext> {
  const ctx = await resolveOrganiserEvent(organiserId, orgSlug, event.id);
  if (!ctx) throw new Error("organiser context missing");
  return ctx;
}

async function statusOf(rsvpId: string) {
  return (await prisma.rSVP.findUniqueOrThrow({ where: { id: rsvpId } })).status;
}

/**
 * docs/TEAMS.md invariants, checked after every mutation: each member's status
 * equals its team's status, the leader is a member, no team is empty or above
 * `teamMaxSize`, and confirmed units never exceed capacity.
 */
async function expectTeamInvariants(event: Event) {
  const current = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
  const teams = await prisma.team.findMany({
    where: { eventId: event.id },
    include: { members: { select: { id: true, status: true, eventId: true } } },
  });
  for (const team of teams) {
    expect(team.members.length, `team ${team.name} is empty`).toBeGreaterThan(0);
    for (const member of team.members) {
      expect(member.status, `member of ${team.name}`).toBe(team.status);
      expect(member.eventId).toBe(event.id);
    }
    if (current.teamMaxSize != null) expect(team.members.length).toBeLessThanOrEqual(current.teamMaxSize);
    expect(team.leaderRsvpId).not.toBeNull();
    expect(team.members.map((member) => member.id)).toContain(team.leaderRsvpId);
  }
  if (current.capacity != null) {
    const units = await prisma.$transaction((tx) => countConfirmedUnits(tx, event.id));
    expect(units).toBeLessThanOrEqual(current.capacity);
  }
}

describe.sequential("team registration integration", () => {
  beforeAll(async () => {
    const [org, otherOrg] = await Promise.all([
      prisma.organisation.create({ data: { name: `Teams ${suffix}`, slug: orgSlug } }),
      prisma.organisation.create({ data: { name: `Teams other ${suffix}`, slug: otherOrgSlug } }),
    ]);
    organisationId = org.id;
    otherOrganisationId = otherOrg.id;
    const [user, otherUser] = await Promise.all([
      prisma.user.create({ data: { name: "Team organiser", email: `organiser-${suffix}@example.test` } }),
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
    if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
    if (otherOrganisationId) await prisma.organisation.delete({ where: { id: otherOrganisationId } });
    await prisma.user.deleteMany({ where: { id: { in: [organiserId, otherOrganiserId].filter(Boolean) } } });
    await prisma.outboxMessage.deleteMany({ where: { createdAt: { gte: startedAt } } });
    await prisma.$disconnect();
  });

  it("leaves INDIVIDUAL events unchanged", async () => {
    const event = await createEvent({ registrationMode: RegistrationMode.INDIVIDUAL, capacity: 1 });
    const first = await registerOk(event, "individual");
    const second = await registerOk(event, "individual");
    expect([first.status, second.status]).toEqual([RsvpStatus.CONFIRMED, RsvpStatus.WAITLISTED]);
    expect([first.teamId, second.teamId]).toEqual([null, null]);

    const { result } = await register(event, "individual", { mode: "create", name: "Not here" });
    expect(result).toEqual({ ok: false, error: "This event does not use team registration." });
    await expect(prisma.team.count({ where: { eventId: event.id } })).resolves.toBe(0);

    await expect(cancelRsvpForUser(null, { checkInToken: first.ticketToken })).resolves.toEqual({ ok: true, data: { cancelled: true } });
    await expect(statusOf(second.rsvpId)).resolves.toBe(RsvpStatus.CONFIRMED);
  });

  it("refuses solo registration on a TEAMS_ONLY event with TEAM_REQUIRED", async () => {
    const event = await createEvent({ soloPolicy: SoloPolicy.TEAMS_ONLY });
    const { result } = await register(event, "solo");
    expect(result).toMatchObject({ ok: false, code: "TEAM_REQUIRED" });
    await expect(prisma.rSVP.count({ where: { eventId: event.id } })).resolves.toBe(0);
  });

  it("keeps team names unique per event, ignoring case and spacing", async () => {
    const event = await createEvent();
    await createTeam(event, "Pixel  Pirates");
    const { result } = await register(event, "dupe", { mode: "create", name: "pixel pirates" });
    expect(result).toEqual({ ok: false, error: "That team name is already taken for this event." });
    await expectTeamInvariants(event);
  });

  it("never oversells the last unit when teams are created concurrently", async () => {
    const event = await createEvent({ capacity: 2 });
    const solo = await registerOk(event, "solo");
    expect(solo.status).toBe(RsvpStatus.CONFIRMED);

    const results = await Promise.all(
      ["Alpha", "Bravo", "Charlie", "Delta"].map((name) => register(event, "racer", { mode: "create", name })),
    );
    expect(results.every(({ result }) => result.ok)).toBe(true);
    const statuses = results.map(({ result }) => (result.ok ? result.data!.status : null));
    expect(statuses.filter((status) => status === RsvpStatus.CONFIRMED)).toHaveLength(1);
    expect(statuses.filter((status) => status === RsvpStatus.WAITLISTED)).toHaveLength(3);
    await expect(prisma.$transaction((tx) => countConfirmedUnits(tx, event.id))).resolves.toBe(2);
    await expect(prisma.team.count({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED } })).resolves.toBe(1);
    await expectTeamInvariants(event);
  });

  it("never exceeds teamMaxSize when people join concurrently", async () => {
    const event = await createEvent({ capacity: 10, teamMaxSize: 3 });
    const { team } = await createTeam(event, "Joiners");

    const results = await Promise.all(
      Array.from({ length: 5 }, () => register(event, "joiner", { mode: "join", joinToken: team.joinToken })),
    );
    expect(results.filter(({ result }) => result.ok)).toHaveLength(2);
    for (const { result } of results.filter(({ result }) => !result.ok)) {
      expect(result).toEqual({ ok: false, error: "This team is already full." });
    }
    await expect(prisma.rSVP.count({ where: { teamId: team.id } })).resolves.toBe(3);
    // Joining never consumes a unit.
    await expect(prisma.$transaction((tx) => countConfirmedUnits(tx, event.id))).resolves.toBe(1);
    await expectTeamInvariants(event);
  });

  it("approves a whole team atomically and refuses approval below the minimum size", async () => {
    const event = await createEvent({ privacyType: EventPrivacyType.APPROVAL_REQUIRED, capacity: 5, teamMinSize: 3, teamMaxSize: 4 });
    const ctx = await organiser(event);
    const { leader, team } = await createTeam(event, "Approvers");
    expect(leader.status).toBe(RsvpStatus.PENDING_APPROVAL);

    const member = await joinTeam(event, team.id);
    expect(member.status).toBe(RsvpStatus.PENDING_APPROVAL);
    await expect(transitionTeamStatus(ctx, team.id, "approve")).resolves.toEqual({
      ok: false,
      error: "This team is incomplete (2 of at least 3 members), so it can't be approved yet.",
    });
    await expectTeamInvariants(event);

    // Individual approval of a team member is refused.
    await expect(approveRsvpForUser(organiserId, { organisationSlug: orgSlug, eventId: event.id, rsvpId: member.rsvpId })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("belongs to a team"),
    });

    const third = await joinTeam(event, team.id);
    const before = new Date();
    const outcomes = await Promise.all([
      transitionTeamStatus(ctx, team.id, "approve"),
      transitionTeamStatus(ctx, team.id, "approve"),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({ ok: false });

    await expect(prisma.team.findUniqueOrThrow({ where: { id: team.id } })).resolves.toMatchObject({ status: RsvpStatus.CONFIRMED });
    const members = await prisma.rSVP.findMany({ where: { teamId: team.id } });
    expect(members.map((rsvp) => rsvp.status)).toEqual([RsvpStatus.CONFIRMED, RsvpStatus.CONFIRMED, RsvpStatus.CONFIRMED]);
    await expectTeamInvariants(event);

    const messages = await prisma.outboxMessage.findMany({ where: { kind: "rsvp-status", createdAt: { gte: before } } });
    const forTeam = messages.filter((message) => (message.payload as { teamName?: string }).teamName === "Approvers");
    expect(forTeam.map((message) => (message.payload as { to: string }).to).sort()).toEqual(
      [leader.email, member.email, third.email].sort(),
    );
  });

  it("refuses joins and leader additions for a rejected team", async () => {
    const event = await createEvent({ privacyType: EventPrivacyType.APPROVAL_REQUIRED });
    const ctx = await organiser(event);
    const { team } = await createTeam(event, "Declined");
    await joinTeam(event, team.id);
    const auth = await leaderAuth(team.id);

    await expect(transitionTeamStatus(ctx, team.id, "reject")).resolves.toEqual({ ok: true, data: { status: RsvpStatus.REJECTED } });
    await expectTeamInvariants(event);

    const { result } = await register(event, "late", { mode: "join", joinToken: team.joinToken });
    expect(result).toEqual({ ok: false, error: "This team can no longer be joined." });
    await expect(loadJoinPageTeam(event.id, team.joinToken)).resolves.toBeNull();
    await expect(addTeamMemberByLeader(auth, { name: "Added Later", email: `added-${suffix}@example.test` })).resolves.toEqual({
      ok: false,
      error: "This team can no longer take new members.",
    });
    await expect(prisma.rSVP.count({ where: { teamId: team.id } })).resolves.toBe(2);
    await expectTeamInvariants(event);
  });

  it("accepting a seeker frees their solo unit and promotes the oldest waitlisted unit", async () => {
    const event = await createEvent({ capacity: 2, soloPolicy: SoloPolicy.SOLO_WITH_MATCHING });
    const teamA = await createTeam(event, "Seekers welcome");
    const seeker = await registerOk(event, "seeker", { mode: "solo", seeker: { headline: "Backend dev", skills: ["Go"] } });
    expect([teamA.leader.status, seeker.status]).toEqual([RsvpStatus.CONFIRMED, RsvpStatus.CONFIRMED]);
    const waiting = await registerOk(event, "waiting");
    const teamB = await createTeam(event, "Waiting team");
    expect([waiting.status, teamB.leader.status]).toEqual([RsvpStatus.WAITLISTED, RsvpStatus.WAITLISTED]);

    const holder = await resolveRsvpByTicketToken(seeker.ticketToken, null);
    if (!holder) throw new Error("seeker did not resolve");
    const authA = await leaderAuth(teamA.team.id);
    const authB = await leaderAuth(teamB.team.id);

    // The seeker also asked to join team B; accepting A's invitation cancels that.
    await expect(setLookingForMembers(authB, true)).resolves.toEqual({ ok: true });
    const request = await createJoinRequest({ direction: "REQUEST", seeker: holder, teamId: teamB.team.id });
    if (!request.ok || !request.data) throw new Error("join request failed");

    const profile = await prisma.teamSeekerProfile.findUniqueOrThrow({ where: { rsvpId: seeker.rsvpId } });
    expect((await listSeekersForLeader(authA))?.map((item) => item.id)).toEqual([profile.id]);
    const invite = await createJoinRequest({ direction: "INVITE", leader: authA, seekerProfileId: profile.id });
    if (!invite.ok || !invite.data) throw new Error("invite failed");
    // Once invited, the seeker appears under the team's pending invitations instead.
    await expect(listSeekersForLeader(authA)).resolves.toEqual([]);
    // Only the invited side may answer.
    await expect(respondToJoinRequest({ actor: { kind: "leader", auth: authA }, requestId: invite.data.requestId, accept: true })).resolves.toEqual({
      ok: false,
      error: "This request is no longer pending.",
    });

    await expect(respondToJoinRequest({ actor: { kind: "seeker", holder }, requestId: invite.data.requestId, accept: true })).resolves.toEqual({
      ok: true,
      data: { accepted: true },
    });

    await expect(prisma.rSVP.findUniqueOrThrow({ where: { id: seeker.rsvpId } })).resolves.toMatchObject({
      teamId: teamA.team.id,
      status: RsvpStatus.CONFIRMED,
    });
    await expect(prisma.teamSeekerProfile.findUniqueOrThrow({ where: { rsvpId: seeker.rsvpId } })).resolves.toMatchObject({ visible: false });
    await expect(prisma.teamJoinRequest.findUniqueOrThrow({ where: { id: request.data.requestId } })).resolves.toMatchObject({
      status: TeamJoinRequestStatus.CANCELLED,
    });
    // The solo waiter registered before team B, so they are the oldest waitlisted unit.
    await expect(statusOf(waiting.rsvpId)).resolves.toBe(RsvpStatus.CONFIRMED);
    await expect(prisma.team.findUniqueOrThrow({ where: { id: teamB.team.id } })).resolves.toMatchObject({ status: RsvpStatus.WAITLISTED });
    await expect(prisma.$transaction((tx) => countConfirmedUnits(tx, event.id))).resolves.toBe(2);
    await expectTeamInvariants(event);
  });

  it("refuses team ids from another event or organisation", async () => {
    const event = await createEvent({ capacity: 10 });
    const otherEvent = await createEvent({ capacity: 10 });
    const foreignEvent = await createEvent({ capacity: 10, organisation: otherOrganisationId });
    const ctx = await organiser(event);
    const local = await createTeam(event, "Home team");
    const elsewhere = await createTeam(otherEvent, "Other event team");
    const elsewhereMember = await joinTeam(otherEvent, elsewhere.team.id);
    const foreign = await createTeam(foreignEvent, "Foreign team");
    const solo = await registerOk(event, "solo");

    // Organiser access is resolved inside the organisation.
    await expect(resolveOrganiserEvent(organiserId, orgSlug, foreignEvent.id)).resolves.toBeNull();
    await expect(resolveOrganiserEvent(organiserId, otherOrgSlug, foreignEvent.id)).resolves.toBeNull();
    await expect(resolveOrganiserEvent(otherOrganiserId, orgSlug, event.id)).resolves.toBeNull();
    const forged: OrganiserEventContext = { ...ctx, eventId: foreignEvent.id };
    await expect(transitionTeamStatus(forged, foreign.team.id, "reject")).resolves.toEqual({ ok: false, error: "Event not found." });

    for (const teamId of [elsewhere.team.id, foreign.team.id]) {
      await expect(transitionTeamStatus(ctx, teamId, "reject")).resolves.toEqual({ ok: false, error: "Team not found." });
      await expect(organiserRenameTeam(ctx, teamId, "Stolen")).resolves.toEqual({ ok: false, error: "Team not found." });
      await expect(organiserDeleteTeam(ctx, teamId)).resolves.toEqual({ ok: false, error: "Team not found." });
      await expect(organiserMoveMember(ctx, { rsvpId: solo.rsvpId, targetTeamId: teamId })).resolves.toEqual({ ok: false, error: "Team not found." });
    }
    await expect(organiserMoveMember(ctx, { rsvpId: elsewhereMember.rsvpId, targetTeamId: local.team.id })).resolves.toEqual({
      ok: false,
      error: "RSVP not found.",
    });

    // A join token only works on its own event.
    const { result } = await register(event, "crosser", { mode: "join", joinToken: elsewhere.team.joinToken });
    expect(result).toEqual({ ok: false, error: "This team link is no longer valid. Ask your team leader for a new one." });
    await expect(loadJoinPageTeam(event.id, elsewhere.team.joinToken)).resolves.toBeNull();

    // Leader authority from one event cannot be pointed at a team elsewhere.
    const localAuth = await leaderAuth(local.team.id);
    const crossAuth: TeamLeaderAuth = { ...localAuth, teamId: elsewhere.team.id };
    await expect(renameTeam(crossAuth, { name: "Hijacked" })).resolves.toEqual({ ok: false, error: "Team not found." });
    await expect(removeTeamMember(localAuth, elsewhereMember.rsvpId)).resolves.toEqual({ ok: false, error: "Member not found." });

    await expect(prisma.team.findUniqueOrThrow({ where: { id: elsewhere.team.id } })).resolves.toMatchObject({ name: "Other event team", status: RsvpStatus.CONFIRMED });
    await expect(prisma.team.findUniqueOrThrow({ where: { id: foreign.team.id } })).resolves.toMatchObject({ name: "Foreign team", status: RsvpStatus.CONFIRMED });
    for (const checked of [event, otherEvent, foreignEvent]) await expectTeamInvariants(checked);
  });

  it("does not let one team's management token act on another team", async () => {
    const event = await createEvent({ capacity: 10 });
    const teamA = await createTeam(event, "Token A");
    const teamB = await createTeam(event, "Token B");
    const memberB = await joinTeam(event, teamB.team.id);

    const authA = await resolveTeamByManageToken(teamA.manageToken);
    expect(authA).toMatchObject({ kind: "token", teamId: teamA.team.id, eventId: event.id });
    const forged: TeamLeaderAuth = { ...authA!, teamId: teamB.team.id };

    await expect(renameTeam(forged, { name: "Taken over" })).resolves.toEqual({ ok: false, error: "Team not found." });
    await expect(removeTeamMember(forged, memberB.rsvpId)).resolves.toEqual({ ok: false, error: "Team not found." });
    await expect(removeTeamMember(authA!, memberB.rsvpId)).resolves.toEqual({ ok: false, error: "Member not found." });
    await expect(transferLeadership(authA!, memberB.rsvpId)).resolves.toEqual({ ok: false, error: "Member not found." });
    await expect(disbandTeam(forged)).resolves.toEqual({ ok: false, error: "Team not found." });
    await expect(regenerateManageToken(forged)).resolves.toEqual({ ok: false, error: "Team not found." });
    await expect(loadTeamPage(forged)).resolves.toBeNull();
    // The check-in token never grants team management.
    await expect(resolveTeamByManageToken(teamB.leader.ticketToken)).resolves.toBeNull();

    await expect(prisma.team.findUniqueOrThrow({ where: { id: teamB.team.id } })).resolves.toMatchObject({ name: "Token B" });
    await expect(prisma.rSVP.count({ where: { teamId: teamB.team.id } })).resolves.toBe(2);

    // Regenerating retires the old link immediately.
    const rotated = await regenerateManageToken(authA!);
    expect(rotated.ok).toBe(true);
    await expect(resolveTeamByManageToken(teamA.manageToken)).resolves.toBeNull();
    await expect(renameTeam(authA!, { name: "Stale" })).resolves.toEqual({ ok: false, error: "Team not found." });
    await expect(resolveTeamByManageToken(rotated.ok ? rotated.data!.manageToken : "")).resolves.toMatchObject({ teamId: teamA.team.id });
    await expectTeamInvariants(event);
  });

  it("passes leadership on when the leader cancels, and frees the unit when the last member leaves", async () => {
    const event = await createEvent({ capacity: 1 });
    const { leader, team, manageToken } = await createTeam(event, "Handover");
    const first = await joinTeam(event, team.id, "first");
    const second = await joinTeam(event, team.id, "second");
    const waiting = await registerOk(event, "waiting");
    expect(waiting.status).toBe(RsvpStatus.WAITLISTED);

    await expect(cancelRsvpForUser(null, { checkInToken: leader.ticketToken })).resolves.toEqual({ ok: true, data: { cancelled: true } });
    const afterLeader = await prisma.team.findUniqueOrThrow({ where: { id: team.id } });
    expect(afterLeader.leaderRsvpId).toBe(first.rsvpId);
    expect(afterLeader.manageTokenHash).not.toBe(team.manageTokenHash);
    await expect(resolveTeamByManageToken(manageToken)).resolves.toBeNull();
    const handover = await prisma.outboxMessage.findMany({ where: { kind: "team-created", payload: { path: ["teamId"], equals: team.id } } });
    expect(handover.map((message) => message.payload)).toContainEqual(expect.objectContaining({ to: first.email, reason: "leader" }));
    await expect(resolveTeamByManageToken(await currentManageToken(team.id))).resolves.toMatchObject({ teamId: team.id });
    // The team is still a confirmed unit, so nobody is promoted.
    await expect(statusOf(waiting.rsvpId)).resolves.toBe(RsvpStatus.WAITLISTED);
    await expectTeamInvariants(event);

    await expect(leaveTeam(null, second.ticketToken)).resolves.toEqual({ ok: true, data: { cancelled: true } });
    await expect(prisma.team.findUniqueOrThrow({ where: { id: team.id } })).resolves.toMatchObject({ leaderRsvpId: first.rsvpId });
    await expectTeamInvariants(event);

    await expect(leaveTeam(null, first.ticketToken)).resolves.toEqual({ ok: true, data: { cancelled: true } });
    await expect(prisma.team.findUnique({ where: { id: team.id } })).resolves.toBeNull();
    await expect(statusOf(waiting.rsvpId)).resolves.toBe(RsvpStatus.CONFIRMED);
    await expectTeamInvariants(event);
  });

  it("disbanding frees the unit and promotes the oldest waitlisted unit", async () => {
    const event = await createEvent({ capacity: 1 });
    const confirmed = await createTeam(event, "Disbanders");
    await joinTeam(event, confirmed.team.id);
    const waitingTeam = await createTeam(event, "First in line");
    const waitingMember = await joinTeam(event, waitingTeam.team.id);
    const waitingSolo = await registerOk(event, "later");
    expect([waitingTeam.leader.status, waitingMember.status, waitingSolo.status]).toEqual([
      RsvpStatus.WAITLISTED,
      RsvpStatus.WAITLISTED,
      RsvpStatus.WAITLISTED,
    ]);

    await expect(disbandTeam(await leaderAuth(confirmed.team.id))).resolves.toEqual({ ok: true, data: { cancelled: 2 } });
    await expect(prisma.team.findUnique({ where: { id: confirmed.team.id } })).resolves.toBeNull();
    await expect(prisma.rSVP.count({ where: { id: confirmed.leader.rsvpId } })).resolves.toBe(0);

    // The waitlisted team is older than the solo waiter: the whole team is promoted together.
    await expect(prisma.team.findUniqueOrThrow({ where: { id: waitingTeam.team.id } })).resolves.toMatchObject({ status: RsvpStatus.CONFIRMED });
    await expect(statusOf(waitingMember.rsvpId)).resolves.toBe(RsvpStatus.CONFIRMED);
    await expect(statusOf(waitingSolo.rsvpId)).resolves.toBe(RsvpStatus.WAITLISTED);
    await expectTeamInvariants(event);
  });

  it("keeps member statuses equal to the team status through organiser moves, removals, and deletes", async () => {
    const event = await createEvent({ capacity: 2, teamMaxSize: 3 });
    const ctx = await organiser(event);
    const confirmed = await createTeam(event, "Confirmed crew");
    const solo = await registerOk(event, "solo");
    const waitlisted = await createTeam(event, "Waitlisted crew");
    const waitlistedMember = await joinTeam(event, waitlisted.team.id);
    expect([confirmed.leader.status, solo.status, waitlisted.leader.status]).toEqual([
      RsvpStatus.CONFIRMED,
      RsvpStatus.CONFIRMED,
      RsvpStatus.WAITLISTED,
    ]);

    // Moving the confirmed solo into a team frees their unit: the waitlisted team is promoted.
    await expect(organiserMoveMember(ctx, { rsvpId: solo.rsvpId, targetTeamId: confirmed.team.id })).resolves.toEqual({
      ok: true,
      data: { status: RsvpStatus.CONFIRMED },
    });
    await expect(prisma.team.findUniqueOrThrow({ where: { id: waitlisted.team.id } })).resolves.toMatchObject({ status: RsvpStatus.CONFIRMED });
    await expectTeamInvariants(event);

    // Moving a member between teams rechecks the target size.
    await expect(organiserMoveMember(ctx, { rsvpId: waitlistedMember.rsvpId, targetTeamId: confirmed.team.id })).resolves.toEqual({
      ok: true,
      data: { status: RsvpStatus.CONFIRMED },
    });
    await expect(organiserMoveMember(ctx, { rsvpId: waitlisted.leader.rsvpId, targetTeamId: confirmed.team.id })).resolves.toEqual({
      ok: false,
      error: "That team is already full.",
    });
    await expectTeamInvariants(event);

    await expect(removeTeamMember(await leaderAuth(confirmed.team.id), solo.rsvpId)).resolves.toEqual({ ok: true });
    await expectTeamInvariants(event);

    const added = await addTeamMemberByLeader(await leaderAuth(waitlisted.team.id), { name: "Added Member", email: `added-member-${suffix}@example.test` });
    expect(added).toMatchObject({ ok: true, data: { status: RsvpStatus.CONFIRMED } });
    await expectTeamInvariants(event);

    const deleted = await organiserDeleteTeam(ctx, waitlisted.team.id);
    expect(deleted).toMatchObject({ ok: true, data: { removed: 2 } });
    await expect(prisma.team.findUnique({ where: { id: waitlisted.team.id } })).resolves.toBeNull();
    await expectTeamInvariants(event);

    await expect(organiserRenameTeam(ctx, confirmed.team.id, "Renamed crew")).resolves.toEqual({ ok: true, data: { name: "Renamed crew" } });
    await expectTeamInvariants(event);
  });

  it("restores a deleted team or member through the existing undo, only while a unit is free", async () => {
    const event = await createEvent({ capacity: 1 });
    const ctx = await organiser(event);
    const { leader, team } = await createTeam(event, "Undo crew");
    const member = await joinTeam(event, team.id);

    // A deleted member goes back into their team, taking its status.
    const memberUndo = await deleteRsvpForUser(organiserId, { organisationSlug: orgSlug, eventId: event.id, rsvpId: member.rsvpId });
    if (!memberUndo.ok || !memberUndo.data) throw new Error("member delete failed");
    await expectTeamInvariants(event);
    await expect(restoreRsvpForUser(organiserId, { organisationSlug: orgSlug, undoId: memberUndo.data.undoId })).resolves.toEqual({ ok: true });
    // Restore keeps the ticket (check-in token), not the row id.
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: member.ticketToken } })).resolves.toMatchObject({ teamId: team.id, status: RsvpStatus.CONFIRMED });
    await expectTeamInvariants(event);

    const deleted = await organiserDeleteTeam(ctx, team.id);
    if (!deleted.ok || !deleted.data) throw new Error("team delete failed");
    expect(deleted.data.removed).toBe(2);
    const other = await createTeam(event, "Took the unit");
    expect(other.leader.status).toBe(RsvpStatus.CONFIRMED);
    await expect(restoreRsvpForUser(organiserId, { organisationSlug: orgSlug, undoId: deleted.data.undoId })).resolves.toEqual({
      ok: false,
      error: "This team cannot be restored because the event is now at capacity.",
    });
    // Another organisation's admin cannot use the undo.
    await expect(restoreRsvpForUser(otherOrganiserId, { organisationSlug: orgSlug, undoId: deleted.data.undoId })).resolves.toMatchObject({ ok: false });

    await expect(organiserDeleteTeam(ctx, other.team.id)).resolves.toMatchObject({ ok: true });
    await expect(restoreRsvpForUser(organiserId, { organisationSlug: orgSlug, undoId: deleted.data.undoId })).resolves.toEqual({ ok: true });
    await expect(prisma.team.findUniqueOrThrow({ where: { id: team.id } })).resolves.toMatchObject({
      status: RsvpStatus.CONFIRMED,
      leaderRsvpId: leader.rsvpId,
    });
    await expect(prisma.rSVP.count({ where: { teamId: team.id } })).resolves.toBe(2);
    await expectTeamInvariants(event);
  });

  it("never lets a leader issue guest tickets on an invite-only event", async () => {
    const event = await createEvent({ capacity: 5 });
    const { team } = await createTeam(event, "Invite crew");
    await prisma.event.update({ where: { id: event.id }, data: { privacyType: EventPrivacyType.INVITE_ONLY } });
    const invitedEmail = `invited-${suffix}@example.test`;
    await prisma.eventInvite.create({ data: { eventId: event.id, email: invitedEmail } });
    const before = await prisma.outboxMessage.count({ where: { kind: "team-member-added" } });

    // Being on the invite list is not proof of owning the address.
    const added = await addTeamMemberByLeader(await leaderAuth(team.id), { name: "Claimed Name", email: invitedEmail });
    expect(added).toMatchObject({ ok: false });
    await expect(prisma.rSVP.count({ where: { eventId: event.id, guestEmail: invitedEmail } })).resolves.toBe(0);
    await expect(prisma.outboxMessage.count({ where: { kind: "team-member-added" } })).resolves.toBe(before);
    await expect(loadTeamPage(await leaderAuth(team.id))).resolves.toMatchObject({ event: { inviteOnly: true } });
  });

  it("does not release a checked-in person's unit by moving them into a team without a place", async () => {
    const event = await createEvent({ capacity: 2 });
    const ctx = await organiser(event);
    const solo = await registerOk(event, "solo");
    const confirmed = await createTeam(event, "Confirmed place");
    const waitlisted = await createTeam(event, "Waiting place");
    const nextSolo = await registerOk(event, "next");
    expect([solo.status, confirmed.leader.status, waitlisted.leader.status, nextSolo.status]).toEqual([
      RsvpStatus.CONFIRMED,
      RsvpStatus.CONFIRMED,
      RsvpStatus.WAITLISTED,
      RsvpStatus.WAITLISTED,
    ]);
    await prisma.rSVP.update({ where: { id: solo.rsvpId }, data: { checkedInAt: new Date() } });

    await expect(organiserMoveMember(ctx, { rsvpId: solo.rsvpId, targetTeamId: waitlisted.team.id })).resolves.toEqual({
      ok: false,
      error: "This person has already checked in, so they can only move to a confirmed team.",
    });
    await expect(statusOf(solo.rsvpId)).resolves.toBe(RsvpStatus.CONFIRMED);
    await expect(prisma.team.findUniqueOrThrow({ where: { id: waitlisted.team.id } })).resolves.toMatchObject({ status: RsvpStatus.WAITLISTED });
    await expectTeamInvariants(event);

    // Into a confirmed team they keep a place, so the move is allowed.
    await expect(organiserMoveMember(ctx, { rsvpId: solo.rsvpId, targetTeamId: confirmed.team.id })).resolves.toEqual({
      ok: true,
      data: { status: RsvpStatus.CONFIRMED },
    });
    await expectTeamInvariants(event);
  });

  it("can undo removing a team's only member by restoring the whole team", async () => {
    const event = await createEvent({ capacity: 3 });
    const { leader, team } = await createTeam(event, "Lone crew");

    const undo = await deleteRsvpForUser(organiserId, { organisationSlug: orgSlug, eventId: event.id, rsvpId: leader.rsvpId });
    if (!undo.ok || !undo.data) throw new Error("delete failed");
    await expect(prisma.team.findUnique({ where: { id: team.id } })).resolves.toBeNull();
    await expectTeamInvariants(event);

    await expect(restoreRsvpForUser(organiserId, { organisationSlug: orgSlug, undoId: undo.data.undoId })).resolves.toEqual({ ok: true });
    await expect(prisma.team.findUniqueOrThrow({ where: { id: team.id } })).resolves.toMatchObject({ status: RsvpStatus.CONFIRMED, leaderRsvpId: leader.rsvpId });
    await expect(prisma.rSVP.findUniqueOrThrow({ where: { checkInToken: leader.ticketToken } })).resolves.toMatchObject({ teamId: team.id, status: RsvpStatus.CONFIRMED });
    await expectTeamInvariants(event);
  });

  it("enforces team settings and join-request rules in the database", async () => {
    const base = {
      organisationId,
      title: `Constraint ${suffix}`,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-01T12:00:00.000Z"),
      timezone: "UTC",
    };
    const invalid = [
      { registrationMode: RegistrationMode.TEAM },
      { registrationMode: RegistrationMode.TEAM, teamMaxSize: 1 },
      { registrationMode: RegistrationMode.TEAM, teamMinSize: 0, teamMaxSize: 3 },
      { registrationMode: RegistrationMode.TEAM, teamMinSize: 4, teamMaxSize: 3 },
    ];
    for (const settings of invalid) {
      await expect(prisma.event.create({ data: { ...base, slug: `constraint-${randomUUID().slice(0, 8)}`, ...settings } })).rejects.toThrow();
    }

    const event = await createEvent({ soloPolicy: SoloPolicy.SOLO_WITH_MATCHING });
    const seeker = await registerOk(event, "seeker");
    await expect(prisma.teamSeekerProfile.create({
      data: { rsvpId: seeker.rsvpId, headline: "Too many skills", skills: Array.from({ length: 9 }, (_, i) => `skill ${i}`) },
    })).rejects.toThrow();

    const { team } = await createTeam(event, "Pending once");
    await prisma.teamJoinRequest.create({ data: { teamId: team.id, rsvpId: seeker.rsvpId, direction: "INVITE" } });
    await expect(prisma.teamJoinRequest.create({ data: { teamId: team.id, rsvpId: seeker.rsvpId, direction: "REQUEST" } })).rejects.toThrow();
    // A closed request does not block a new pending one.
    await prisma.teamJoinRequest.updateMany({ where: { teamId: team.id, rsvpId: seeker.rsvpId }, data: { status: TeamJoinRequestStatus.DECLINED } });
    await expect(prisma.teamJoinRequest.create({ data: { teamId: team.id, rsvpId: seeker.rsvpId, direction: "REQUEST" } })).resolves.toMatchObject({
      status: TeamJoinRequestStatus.PENDING,
    });
  });
});
