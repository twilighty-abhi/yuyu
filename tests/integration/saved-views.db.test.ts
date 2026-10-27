import { randomUUID } from "node:crypto";
import { EventPermission, EventStatus, JudgingStatus, MembershipRole, RegistrationMode, RsvpStatus, SubmissionStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { deleteView, renameView, saveView, shareView } from "@/app/actions/saved-views";
import { listSavedViews, loadDashboardSavedViews, resolveSavedViewAccess } from "@/lib/core/savedViews";
import { countUnsubmittedEntrants, listUnsubmittedEntrants } from "@/lib/core/judgingEntrants";
import { loadJudgingResultsPage } from "@/lib/core/judging";
import { countEventTeamsForOrganiser, listEventTeamsForOrganiser } from "@/lib/core/teams";
import { listAttendeesPage } from "@/lib/eventDashboard/attendees";
import { resolveJudgingOrganiser } from "@/lib/judgingAccess";

/*
 * Saved views against PostgreSQL (docs/FEATURES.md, "Saved views"): the
 * surface's own permission gates every action, views are scoped to their
 * event, organisation and surface, params are sanitised on write and read,
 * only creators rename or share, owners/admins delete shared views, audits,
 * cascades and CHECKs; plus the server filters behind the presets (Not
 * checked in, Looking for members, Not submitted, Unscored / fewer than 2).
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `views-${suffix}`;
const otherOrgSlug = `views-other-${suffix}`;
const startedAt = new Date();
let organisationId = "";
let otherOrganisationId = "";
const users: Record<"owner" | "admin" | "member" | "registrar" | "judge" | "otherOwner", string> = { owner: "", admin: "", member: "", registrar: "", judge: "", otherOwner: "" };
let teamEvent: Event;
let otherEvent: Event;
let foreignEvent: Event;
let sequence = 0;

async function createEvent(orgId: string, mode: RegistrationMode = RegistrationMode.TEAM): Promise<Event> {
  return prisma.event.create({
    data: {
      organisationId: orgId,
      title: `Views ${suffix}`,
      slug: `views-${suffix}-${randomUUID().slice(0, 8)}`,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-02T10:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      registrationMode: mode,
      teamMinSize: mode === RegistrationMode.TEAM ? 2 : undefined,
      teamMaxSize: mode === RegistrationMode.TEAM ? 4 : undefined,
      submissionsEnabled: true,
      judgingStatus: JudgingStatus.OPEN,
      page: { create: { isPublished: true } },
    },
  });
}

async function rsvp(event: Event, options: { status?: RsvpStatus; teamId?: string | null; checkedIn?: boolean; name?: string } = {}) {
  sequence += 1;
  return prisma.rSVP.create({
    data: {
      eventId: event.id,
      guestEmail: `guest-${sequence}-${suffix}@example.test`,
      guestName: options.name ?? `Guest ${sequence}`,
      attendeeKey: `guest:guest-${sequence}-${suffix}@example.test`,
      status: options.status ?? RsvpStatus.CONFIRMED,
      teamId: options.teamId ?? null,
      checkedInAt: options.checkedIn ? new Date() : null,
      createdAt: new Date(Date.UTC(2030, 0, 1, 0, sequence)),
    },
  });
}

async function team(event: Event, name: string, options: { status?: RsvpStatus; members?: number; looking?: boolean } = {}) {
  sequence += 1;
  const created = await prisma.team.create({
    data: {
      eventId: event.id,
      name,
      nameKey: name.toLowerCase(),
      status: options.status ?? RsvpStatus.CONFIRMED,
      joinToken: `join-${randomUUID()}`,
      manageTokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
      lookingForMembers: options.looking ?? false,
      createdAt: new Date(Date.UTC(2030, 0, 1, 0, sequence)),
    },
  });
  for (let index = 0; index < (options.members ?? 2); index += 1) await rsvp(event, { status: options.status ?? RsvpStatus.CONFIRMED, teamId: created.id });
  return created;
}

const scope = (surface: string, event: Event = teamEvent, slug = orgSlug) => ({ organisationSlug: slug, eventId: event.id, surface });

function as(user: keyof typeof users) {
  session.userId = users[user];
}

beforeAll(async () => {
    const [org, other] = await Promise.all([
      prisma.organisation.create({ data: { name: `Views ${suffix}`, slug: orgSlug } }),
      prisma.organisation.create({ data: { name: `Views other ${suffix}`, slug: otherOrgSlug } }),
    ]);
    organisationId = org.id;
    otherOrganisationId = other.id;
    for (const key of Object.keys(users) as Array<keyof typeof users>) {
      const user = await prisma.user.create({ data: { name: `User ${key}`, email: `${key}-${suffix}@example.test`, emailVerified: new Date() } });
      users[key] = user.id;
    }
    await prisma.membership.createMany({
      data: [
        { userId: users.owner, organisationId, role: MembershipRole.OWNER },
        { userId: users.admin, organisationId, role: MembershipRole.ADMIN },
        { userId: users.member, organisationId, role: MembershipRole.MEMBER },
        { userId: users.otherOwner, organisationId: otherOrganisationId, role: MembershipRole.OWNER },
      ],
    });
    teamEvent = await createEvent(organisationId);
    otherEvent = await createEvent(organisationId);
    foreignEvent = await createEvent(otherOrganisationId);
    await prisma.eventCollaborator.create({ data: { eventId: teamEvent.id, userId: users.registrar, permissions: [EventPermission.MANAGE_REGISTRATIONS] } });
    await prisma.eventCollaborator.create({ data: { eventId: teamEvent.id, userId: users.judge, permissions: [EventPermission.JUDGE] } });
  });

  afterAll(async () => {
    session.userId = null;
    for (const id of [organisationId, otherOrganisationId]) if (id) await prisma.organisation.delete({ where: { id } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).filter(Boolean) } } });
    await prisma.auditEvent.deleteMany({ where: { createdAt: { gte: startedAt }, action: { startsWith: "SAVED_VIEW_" } } });
    await prisma.$disconnect();
  });

describe.sequential("saved views", () => {

  it("gates every surface on its own permission", async () => {
    expect(await resolveSavedViewAccess(users.owner, orgSlug, teamEvent.id, "GUESTS_PEOPLE")).toMatchObject({ isAdmin: true, organisationId });
    expect(await resolveSavedViewAccess(users.registrar, orgSlug, teamEvent.id, "GUESTS_PEOPLE")).toMatchObject({ isAdmin: false });
    expect(await resolveSavedViewAccess(users.registrar, orgSlug, teamEvent.id, "GUESTS_TEAMS")).not.toBeNull();
    // MANAGE_REGISTRATIONS is not judging management.
    expect(await resolveSavedViewAccess(users.registrar, orgSlug, teamEvent.id, "JUDGING_SUBMISSIONS")).toBeNull();
    // A JUDGE collaborator manages neither guests nor judging.
    expect(await resolveSavedViewAccess(users.judge, orgSlug, teamEvent.id, "GUESTS_PEOPLE")).toBeNull();
    expect(await resolveSavedViewAccess(users.judge, orgSlug, teamEvent.id, "JUDGING_RESULTS")).toBeNull();
    // A plain member without a grant, and an owner of another organisation, get nothing.
    expect(await resolveSavedViewAccess(users.member, orgSlug, teamEvent.id, "GUESTS_PEOPLE")).toBeNull();
    expect(await resolveSavedViewAccess(users.otherOwner, orgSlug, teamEvent.id, "GUESTS_PEOPLE")).toBeNull();
    // The event must belong to the organisation in the slug.
    expect(await resolveSavedViewAccess(users.owner, orgSlug, foreignEvent.id, "GUESTS_PEOPLE")).toBeNull();
    // Teams only exist on TEAM events.
    const individual = await createEvent(organisationId, RegistrationMode.INDIVIDUAL);
    expect(await resolveSavedViewAccess(users.owner, orgSlug, individual.id, "GUESTS_TEAMS")).toBeNull();

    as("member");
    expect(await saveView({ ...scope("GUESTS_PEOPLE"), name: "Nope", params: {} })).toEqual({ ok: false, error: "You do not have permission to use views on this list." });
    as("judge");
    expect(await saveView({ ...scope("JUDGING_SUBMISSIONS"), name: "Nope", params: {} })).toMatchObject({ ok: false });
    expect(await prisma.savedView.count({ where: { eventId: teamEvent.id } })).toBe(0);
  });

  it("saves sanitised params, lists own and shared views, and audits create/share/delete", async () => {
    as("registrar");
    const created = await saveView({ ...scope("GUESTS_PEOPLE"), name: "  Waiting list  ", params: { status: "waitlist", kind: "all", cursor: "1.x", organisationId: otherOrganisationId, q: "<b>Asha</b>" } });
    if (!created.ok || !created.data?.view) throw new Error("save failed");
    const view = created.data.view;
    expect(view).toMatchObject({ name: "Waiting list", params: { status: "waitlist", q: "b Asha /b" }, shared: false, mine: true, canDelete: true });
    const row = await prisma.savedView.findUniqueOrThrow({ where: { id: view.id } });
    expect(row).toMatchObject({ organisationId, eventId: teamEvent.id, userId: users.registrar, surface: "GUESTS_PEOPLE" });
    expect(row.params).toEqual({ q: "b Asha /b", status: "waitlist" });

    // Private: the owner can't see it, nor delete it.
    as("owner");
    let ownerCtx = (await resolveSavedViewAccess(users.owner, orgSlug, teamEvent.id, "GUESTS_PEOPLE"))!;
    expect(await listSavedViews(ownerCtx)).toEqual([]);
    expect(await deleteView({ ...scope("GUESTS_PEOPLE"), viewId: view.id })).toEqual({ ok: false, error: "That view no longer exists." });

    // Only the creator shares it.
    expect(await shareView({ ...scope("GUESTS_PEOPLE"), viewId: view.id, shared: true })).toEqual({ ok: false, error: "That view no longer exists." });
    as("registrar");
    expect(await shareView({ ...scope("GUESTS_PEOPLE"), viewId: view.id, shared: true })).toMatchObject({ ok: true, data: { view: { shared: true } } });

    as("owner");
    ownerCtx = (await resolveSavedViewAccess(users.owner, orgSlug, teamEvent.id, "GUESTS_PEOPLE"))!;
    const seen = await listSavedViews(ownerCtx);
    expect(seen).toEqual([expect.objectContaining({ id: view.id, mine: false, shared: true, canDelete: true, createdBy: "User registrar" })]);
    // Shared does not mean editable.
    expect(await renameView({ ...scope("GUESTS_PEOPLE"), viewId: view.id, name: "Mine now" })).toEqual({ ok: false, error: "That view no longer exists." });
    expect(await shareView({ ...scope("GUESTS_PEOPLE"), viewId: view.id, shared: false })).toMatchObject({ ok: false });
    // Views stay on their surface and event.
    expect(await deleteView({ ...scope("GUESTS_TEAMS"), viewId: view.id })).toMatchObject({ ok: false });
    expect(await deleteView({ ...scope("GUESTS_PEOPLE", otherEvent), viewId: view.id })).toMatchObject({ ok: false });
    expect(await loadDashboardSavedViews({ userId: users.owner, organisationId, eventId: otherEvent.id, isAdmin: true }, ["GUESTS_PEOPLE"])).toEqual({ GUESTS_PEOPLE: [] });

    // Owners and admins delete a shared view.
    expect(await deleteView({ ...scope("GUESTS_PEOPLE"), viewId: view.id })).toEqual({ ok: true, data: { views: [] } });
    expect(await prisma.savedView.count({ where: { id: view.id } })).toBe(0);

    const audits = await prisma.auditEvent.findMany({ where: { targetId: view.id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((audit) => audit.action)).toEqual(["SAVED_VIEW_CREATED", "SAVED_VIEW_SHARED", "SAVED_VIEW_DELETED"]);
    expect(audits[2]).toMatchObject({ actorUserId: users.owner, organisationId, metadata: { eventId: teamEvent.id, surface: "GUESTS_PEOPLE", shared: true, ownView: false } });
    for (const audit of audits) expect(JSON.stringify(audit.metadata)).not.toContain("Waiting");
  });

  it("lets the creator rename and delete; refuses bad names; re-sanitises params on read", async () => {
    as("admin");
    const created = await saveView({ ...scope("JUDGING_RESULTS"), name: "Thin", params: { scored: "underTwo" } });
    if (!created.ok || !created.data?.view) throw new Error("save failed");
    const id = created.data.view.id;
    expect(await renameView({ ...scope("JUDGING_RESULTS"), viewId: id, name: "x".repeat(61) })).toMatchObject({ ok: false, fieldErrors: { name: [expect.any(String)] } });
    expect(await renameView({ ...scope("JUDGING_RESULTS"), viewId: id, name: "Fewer than two" })).toMatchObject({ ok: true, data: { view: { name: "Fewer than two" } } });
    expect(await saveView({ ...scope("JUDGING_RESULTS"), name: "   ", params: {} })).toMatchObject({ ok: false, fieldErrors: { name: [expect.any(String)] } });

    // A stored row with keys outside the allow-list (an old version, a manual edit) only shows what is allowed.
    await prisma.savedView.update({ where: { id }, data: { params: { scored: "unscored", status: "REJECTED", query: "x" } } });
    const ctx = (await resolveSavedViewAccess(users.admin, orgSlug, teamEvent.id, "JUDGING_RESULTS"))!;
    expect((await listSavedViews(ctx))[0]!.params).toEqual({ scored: "unscored" });

    // The owner can't delete another person's private view.
    as("owner");
    expect(await deleteView({ ...scope("JUDGING_RESULTS"), viewId: id })).toMatchObject({ ok: false });
    as("admin");
    expect(await deleteView({ ...scope("JUDGING_RESULTS"), viewId: id })).toEqual({ ok: true, data: { views: [] } });
  });

  it("does not let a non-admin delete someone else's shared view", async () => {
    as("owner");
    const created = await saveView({ ...scope("GUESTS_PEOPLE"), name: "Arrivals", params: { status: "checkedIn" }, shared: true });
    if (!created.ok || !created.data?.view) throw new Error("save failed");
    as("registrar");
    const ctx = (await resolveSavedViewAccess(users.registrar, orgSlug, teamEvent.id, "GUESTS_PEOPLE"))!;
    expect(await listSavedViews(ctx)).toEqual([expect.objectContaining({ id: created.data.view.id, mine: false, canDelete: false })]);
    expect(await deleteView({ ...scope("GUESTS_PEOPLE"), viewId: created.data.view.id })).toEqual({ ok: false, error: "Only the person who saved this view, or an owner or admin, can delete it." });
    as("owner");
    expect(await deleteView({ ...scope("GUESTS_PEOPLE"), viewId: created.data.view.id })).toMatchObject({ ok: true });
  });

  it("enforces the name length and object params in the database and cascades from event and user", async () => {
    const base = { organisationId, eventId: otherEvent.id, userId: users.owner, surface: "GUESTS_PEOPLE" as const };
    await expect(prisma.savedView.create({ data: { ...base, name: "", params: {} } })).rejects.toThrow();
    await expect(prisma.savedView.create({ data: { ...base, name: "x".repeat(61), params: {} } })).rejects.toThrow();
    await expect(prisma.savedView.create({ data: { ...base, name: "Array", params: ["status"] } })).rejects.toThrow();
    const kept = await prisma.savedView.create({ data: { ...base, name: "Kept", params: {} } });
    const byUser = await prisma.savedView.create({ data: { ...base, userId: users.member, name: "Gone with user", params: {} } });
    await prisma.user.delete({ where: { id: users.member } });
    users.member = "";
    expect(await prisma.savedView.count({ where: { id: byUser.id } })).toBe(0);
    expect(await prisma.savedView.count({ where: { id: kept.id } })).toBe(1);
    await prisma.event.delete({ where: { id: otherEvent.id } });
    expect(await prisma.savedView.count({ where: { id: kept.id } })).toBe(0);
    otherEvent = await createEvent(organisationId);
  });

  it("always lists the viewer's own views, however many others share, and reads each surface on its own", async () => {
    const event = await createEvent(organisationId);
    const at = (minute: number) => new Date(Date.UTC(2030, 0, 1, 0, minute));
    // 240 older shared People views from the owner and admin: more than one menu holds.
    await prisma.savedView.createMany({
      data: Array.from({ length: 240 }, (_, index) => ({
        organisationId,
        eventId: event.id,
        userId: index % 2 ? users.owner : users.admin,
        surface: "GUESTS_PEOPLE" as const,
        name: `Shared ${index}`,
        params: {},
        shared: true,
        createdAt: at(index),
      })),
    });
    const mine = await prisma.savedView.create({ data: { organisationId, eventId: event.id, userId: users.registrar, surface: "GUESTS_PEOPLE", name: "Mine, newest", params: {}, createdAt: at(500) } });
    const teams = await prisma.savedView.create({ data: { organisationId, eventId: event.id, userId: users.owner, surface: "GUESTS_TEAMS", name: "Teams view", params: {}, createdAt: at(600) } });

    const ctx = { userId: users.registrar, organisationId, orgSlug, eventId: event.id, surface: "GUESTS_PEOPLE" as const, isAdmin: false };
    const listed = await listSavedViews(ctx);
    expect(listed).toHaveLength(100);
    expect(listed[0]).toMatchObject({ id: mine.id, mine: true });
    expect(listed.slice(1).every((view) => !view.mine && view.shared)).toBe(true);
    expect(listed[1]!.name).toBe("Shared 0");

    // A busy People list no longer crowds the Teams menu out of the dashboard read.
    const dashboard = await loadDashboardSavedViews({ userId: users.owner, organisationId, eventId: event.id, isAdmin: true }, ["GUESTS_PEOPLE", "GUESTS_TEAMS"]);
    expect(dashboard.GUESTS_TEAMS).toEqual([expect.objectContaining({ id: teams.id, mine: true })]);
    expect(dashboard.GUESTS_PEOPLE).toHaveLength(100);
    // The owner's own 120 People views come first; the registrar's private view is never listed.
    expect(dashboard.GUESTS_PEOPLE!.every((view) => view.mine)).toBe(true);
    expect(dashboard.GUESTS_PEOPLE!.some((view) => view.id === mine.id)).toBe(false);
    await prisma.event.delete({ where: { id: event.id } });
  });
});

describe.sequential("filters behind the presets", () => {
  it("People: Not checked in counts going guests who haven't arrived", async () => {
    const event = await createEvent(organisationId, RegistrationMode.INDIVIDUAL);
    await rsvp(event, { checkedIn: true });
    await rsvp(event);
    await rsvp(event);
    await rsvp(event, { status: RsvpStatus.WAITLISTED });
    const page = await listAttendeesPage({ kind: "event", eventId: event.id, organisationId }, { status: "notCheckedIn" }, { origin: "https://yuyu.example", teamMode: false });
    expect(page.rows).toHaveLength(2);
    expect(page.counts).toMatchObject({ all: 4, going: 3, checkedIn: 1, notCheckedIn: 2, waitlist: 1 });
    expect(page.matching).toBe(2);
  });

  it("Teams: Looking for members filters and counts", async () => {
    const event = await createEvent(organisationId);
    await team(event, "Seekers", { looking: true });
    await team(event, "Full", { members: 3 });
    const ctx = { userId: users.owner, organisationId, orgSlug, eventId: event.id, eventSlug: event.slug };
    expect((await listEventTeamsForOrganiser(ctx, { filter: "looking" })).teams.map((row) => row.name)).toEqual(["Seekers"]);
    expect(await countEventTeamsForOrganiser(ctx)).toMatchObject({ all: 2, looking: 1 });
  });

  it("Submissions: Not submitted lists confirmed teams and solos without a SUBMITTED project", async () => {
    const event = await createEvent(organisationId);
    const drafting = await team(event, "Drafting");
    const done = await team(event, "Done");
    await team(event, "Empty");
    await team(event, "Waiting", { status: RsvpStatus.WAITLISTED });
    const soloNone = await rsvp(event, { name: "Ada Lovelace" });
    const soloDone = await rsvp(event, { name: "Grace Hopper" });
    await rsvp(event, { name: "Pending Person", status: RsvpStatus.PENDING_APPROVAL });
    await prisma.submission.createMany({
      data: [
        { eventId: event.id, teamId: drafting.id, title: "Half a robot", status: SubmissionStatus.DRAFT },
        { eventId: event.id, teamId: done.id, title: "Whole robot", status: SubmissionStatus.SUBMITTED, submittedAt: new Date() },
        { eventId: event.id, rsvpId: soloDone.id, title: "Compiler", status: SubmissionStatus.SUBMITTED, submittedAt: new Date() },
      ],
    });
    const ctx = (await resolveJudgingOrganiser(users.owner, orgSlug, event.id))!;
    expect(await countUnsubmittedEntrants(ctx)).toBe(3);
    const page = await listUnsubmittedEntrants(ctx);
    expect(page.entrants.map((row) => [row.kind, row.name, row.submissionStatus])).toEqual([
      ["team", "Drafting", "DRAFT"],
      ["team", "Empty", null],
      ["solo", "Ada L.", null],
    ]);
    expect(page.entrants[0]).toMatchObject({ size: 2, submissionTitle: "Half a robot" });
    expect(page.entrants.find((row) => row.kind === "solo")?.id).toBe(soloNone.id);
    expect(JSON.stringify(page)).not.toContain("@example.test");
    expect((await listUnsubmittedEntrants(ctx, { query: "robot" })).entrants.map((row) => row.name)).toEqual(["Drafting"]);
    expect(await countUnsubmittedEntrants(ctx, "ada")).toBe(1);
    // Another organisation's owner gets nothing for this event.
    const foreign = { ...ctx, organisationId: otherOrganisationId };
    expect(await countUnsubmittedEntrants(foreign)).toBe(0);
    expect((await listUnsubmittedEntrants(foreign)).entrants).toEqual([]);
  });

  it("Results: Unscored and fewer than 2 judges keep ranks and count over the whole ranking", async () => {
    const event = await createEvent(organisationId, RegistrationMode.INDIVIDUAL);
    const criterion = await prisma.judgingCriterion.create({ data: { eventId: event.id, name: "Impact", weight: 1, maxScore: 10 } });
    const projects = [];
    for (const title of ["Zero", "One", "Two"]) {
      const entrant = await rsvp(event, { name: `Entrant ${title}` });
      projects.push(await prisma.submission.create({ data: { eventId: event.id, rsvpId: entrant.id, title, status: SubmissionStatus.SUBMITTED, submittedAt: new Date() } }));
    }
    const judges = [users.owner, users.admin];
    for (const [index, judgeUserId] of judges.entries()) {
      for (const project of projects.slice(index === 0 ? 1 : 2)) {
        await prisma.judgeScore.create({ data: { submissionId: project.id, judgeUserId, criterionId: criterion.id, score: 7 } });
        await prisma.judgeReview.create({ data: { submissionId: project.id, judgeUserId, submittedAt: new Date() } });
      }
    }
    const ctx = (await resolveJudgingOrganiser(users.owner, orgSlug, event.id))!;
    const all = await loadJudgingResultsPage(ctx, {});
    expect(all?.scoreCounts).toEqual({ all: 3, unscored: 1, underTwo: 2 });
    const unscored = await loadJudgingResultsPage(ctx, { scored: "unscored" });
    expect(unscored?.rows.map((row) => row.title)).toEqual(["Zero"]);
    const underTwo = await loadJudgingResultsPage(ctx, { scored: "underTwo" });
    expect(underTwo?.rows.map((row) => [row.title, row.judgesCounted])).toEqual(expect.arrayContaining([["Zero", 0], ["One", 1]]));
    expect(underTwo?.total).toBe(2);
    const rankOfOne = all?.rows.find((row) => row.title === "One")?.rank;
    expect(underTwo?.rows.find((row) => row.title === "One")?.rank).toBe(rankOfOne);
  });
});
