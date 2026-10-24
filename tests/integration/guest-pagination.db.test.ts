import { randomUUID } from "node:crypto";
import { EventPermission, EventPrivacyType, EventStatus, MembershipRole, RegistrationMode, RsvpStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: async () => undefined }));
vi.mock("@/lib/publicUrl", () => ({ getRequestOrigin: async () => "https://events.example.test" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { ATTENDEES_PAGE_SIZE } from "@/lib/attendeeListQuery";
import { listAttendeesPage } from "@/lib/eventDashboard/attendees";
import { INVITES_PAGE_SIZE, listEventInvitesPage } from "@/lib/eventDashboard/invites";
import { LIST_ROSTER_PAGE_SIZE, loadCheckInListRosterPage } from "@/lib/eventDashboard/checkInLists";
import { RECENT_CHECK_INS_PAGE_SIZE, listRecentCheckIns } from "@/lib/checkInRecent";
import { listTeamMoveTargetsForOrganiser, resolveOrganiserEvent, TEAM_MOVE_TARGETS_PAGE_SIZE, type OrganiserEventContext } from "@/lib/core/teams";
import { teamNameKey } from "@/lib/validators";
import { loadAttendeesPage } from "@/app/actions/guest-list";
import { loadInvitesPage } from "@/app/actions/invites";
import { searchMoveTargets } from "@/app/actions/team-admin";
import { loadRecentCheckIns } from "@/app/actions/checkin";
import { loadListRosterPage } from "@/app/actions/checkin-lists";
import { GET as exportEmails } from "@/app/api/exports/events/[eventId]/attendee-emails/route";

/*
 * Server-side paging for the Guests tab and the check-in desk: every page
 * walk returns each row exactly once in a stable order, filters and counts
 * agree with direct counts, and every loader and action stays inside its
 * event and organisation.
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `paging-${suffix}`;
const otherOrgSlug = `paging-other-${suffix}`;
let organisationId = "";
let otherOrganisationId = "";
let adminId = "";
let memberId = "";
let otherAdminId = "";
let checkInHelperId = "";
let inviterId = "";
let event: Event;
let otherEvent: Event;
let organiser: OrganiserEventContext;
let sequence = 0;

const base = new Date("2030-03-01T09:00:00.000Z");
const minutes = (n: number) => new Date(base.getTime() + n * 60_000);

async function createEvent(organisation: string, teamMaxSize = 3) {
  return prisma.event.create({ data: {
    organisationId: organisation,
    title: `Paging ${suffix}`,
    slug: `paging-${suffix}-${randomUUID().slice(0, 8)}`,
    startDateTime: new Date("2035-01-01T10:00:00.000Z"),
    endDateTime: new Date("2035-01-02T10:00:00.000Z"),
    timezone: "UTC",
    status: EventStatus.PUBLISHED,
    privacyType: EventPrivacyType.PUBLIC,
    registrationMode: RegistrationMode.TEAM,
    teamMaxSize,
    page: { create: { isPublished: true } },
  } });
}

async function createTeam(target: Event, name: string, status: RsvpStatus, createdAt: Date) {
  return prisma.team.create({ data: {
    eventId: target.id,
    name,
    nameKey: teamNameKey(name),
    status,
    joinToken: randomUUID(),
    manageTokenHash: randomUUID(),
    createdAt,
  } });
}

async function addRsvp(target: Event, data: { status?: RsvpStatus; createdAt: Date; name?: string; teamId?: string | null; userId?: string | null; checkedInAt?: Date | null }) {
  sequence += 1;
  const email = `guest-${sequence}-${suffix}@example.test`;
  return prisma.rSVP.create({ data: {
    eventId: target.id,
    guestEmail: data.userId ? null : email,
    guestName: data.userId ? null : data.name ?? `Guest ${sequence}`,
    userId: data.userId ?? null,
    attendeeKey: data.userId ? `user:${data.userId}` : `guest:${email}`,
    status: data.status ?? RsvpStatus.CONFIRMED,
    teamId: data.teamId ?? null,
    createdAt: data.createdAt,
    checkedInAt: data.checkedInAt ?? null,
  } });
}

/** Walk every page of a cursor list. */
async function walk<R>(fetch: (cursor: string | null) => Promise<{ rows: R[]; nextCursor: string | null }>, pageSize: number) {
  const rows: R[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const page = await fetch(cursor);
    expect(page.rows.length).toBeLessThanOrEqual(pageSize);
    if (page.nextCursor) expect(page.rows.length).toBe(pageSize);
    rows.push(...page.rows);
    cursor = page.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(100);
  } while (cursor);
  return { rows, pages };
}

const scope = () => ({ kind: "event" as const, eventId: event.id, organisationId });
const options = { origin: "https://events.example.test", teamMode: true };

beforeAll(async () => {
  const [org, otherOrg] = await Promise.all([
    prisma.organisation.create({ data: { name: `Paging ${suffix}`, slug: orgSlug } }),
    prisma.organisation.create({ data: { name: `Paging other ${suffix}`, slug: otherOrgSlug } }),
  ]);
  organisationId = org.id;
  otherOrganisationId = otherOrg.id;
  const users = await Promise.all(
    ["admin", "member", "other-admin", "checkin-helper", "inviter", "signed-in-a", "signed-in-b"].map((label) =>
      prisma.user.create({ data: { name: `Paging ${label}`, email: `${label}-${suffix}@example.test` } }),
    ),
  );
  [adminId, memberId, otherAdminId, checkInHelperId, inviterId] = users.map((user) => user.id) as [string, string, string, string, string];
  await prisma.membership.createMany({ data: [
    { userId: adminId, organisationId, role: MembershipRole.ADMIN },
    { userId: memberId, organisationId, role: MembershipRole.MEMBER },
    { userId: otherAdminId, organisationId: otherOrganisationId, role: MembershipRole.ADMIN },
  ] });

  event = await createEvent(organisationId);
  otherEvent = await createEvent(otherOrganisationId);
  await prisma.eventCollaborator.createMany({ data: [
    { eventId: event.id, userId: checkInHelperId, permissions: [EventPermission.CHECK_IN] },
    { eventId: event.id, userId: inviterId, permissions: [EventPermission.MANAGE_INVITATIONS] },
  ] });

  // 40 teams, alphabetical names out of creation order: every fourth one
  // full (3 members), "Zulu declined" rejected, the rest with 1 member.
  const teams = [];
  for (let i = 0; i < 40; i += 1) {
    const name = `Team ${String((i * 7) % 40).padStart(2, "0")} ${i % 2 ? "alpha" : "Beta"}`;
    teams.push(await createTeam(event, name, RsvpStatus.CONFIRMED, minutes(i)));
  }
  const rejected = await createTeam(event, "Zulu declined", RsvpStatus.REJECTED, minutes(31));
  let at = 0;
  for (const [index, team] of teams.entries()) {
    const size = index % 4 === 0 ? 3 : 1;
    for (let m = 0; m < size; m += 1) {
      const rsvp = await addRsvp(event, { createdAt: minutes(100 + at), teamId: team.id, name: `Member ${team.name} ${m}`, checkedInAt: at % 2 === 0 ? minutes(1000 + Math.floor(at / 4)) : null });
      at += 1;
      if (m === 0) await prisma.team.update({ where: { id: team.id }, data: { leaderRsvpId: rsvp.id } });
    }
  }
  const declinedLeader = await addRsvp(event, { status: RsvpStatus.REJECTED, createdAt: minutes(99), teamId: rejected.id });
  await prisma.team.update({ where: { id: rejected.id }, data: { leaderRsvpId: declinedLeader.id } });
  // 120 solo registrations with mixed statuses (half confirmed); ten share
  // one createdAt to exercise the id tie-break. Together every list here
  // spans more than one page: guests, check-ins and the list roster.
  const statuses = [RsvpStatus.CONFIRMED, RsvpStatus.WAITLISTED, RsvpStatus.CONFIRMED, RsvpStatus.PENDING_APPROVAL, RsvpStatus.CONFIRMED, RsvpStatus.REJECTED];
  for (let i = 0; i < 120; i += 1) {
    await addRsvp(event, { status: statuses[i % statuses.length], createdAt: i < 10 ? minutes(500) : minutes(200 + i), name: i === 42 ? "Ada Needle" : undefined });
  }
  await addRsvp(event, { createdAt: minutes(600), userId: users[5]!.id });
  await addRsvp(event, { createdAt: minutes(601), userId: users[6]!.id, checkedInAt: minutes(2000) });
  // Another organisation's event with lookalike data.
  await addRsvp(otherEvent, { createdAt: minutes(1), name: "Ada Needle" });
  await createTeam(otherEvent, "Team 00 Beta", RsvpStatus.CONFIRMED, minutes(1));

  const ctx = await resolveOrganiserEvent(adminId, orgSlug, event.id);
  if (!ctx) throw new Error("organiser context missing");
  organiser = ctx;
});

afterAll(async () => {
  session.userId = null;
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  if (otherOrganisationId) await prisma.organisation.delete({ where: { id: otherOrganisationId } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.test` } } });
});

describe("guest list paging", () => {
  it("walks every registration once, newest first with an id tie-break", async () => {
    const expected = await prisma.rSVP.findMany({ where: { eventId: event.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    expect(expected.length).toBeGreaterThan(ATTENDEES_PAGE_SIZE * 2);
    const { rows, pages } = await walk((cursor) => listAttendeesPage(scope(), { cursor }, options), ATTENDEES_PAGE_SIZE);
    expect(rows.map((row) => row.id)).toEqual(expected.map((row) => row.id));
    expect(pages).toBe(Math.ceil(expected.length / ATTENDEES_PAGE_SIZE));
    expect(rows[0]!.ticketUrl).toMatch(/^https:\/\/events\.example\.test\/ticket\//);
  });

  it("counts every chip in the database, under the current search and filters", async () => {
    const first = await listAttendeesPage(scope(), {}, options);
    const count = (where: object) => prisma.rSVP.count({ where: { eventId: event.id, ...where } });
    expect(first.total).toBe(await count({}));
    expect(first.counts).toEqual({
      all: await count({}),
      going: await count({ status: RsvpStatus.CONFIRMED }),
      waitlist: await count({ status: RsvpStatus.WAITLISTED }),
      approve: await count({ status: RsvpStatus.PENDING_APPROVAL }),
      declined: await count({ status: RsvpStatus.REJECTED }),
      checkedIn: await count({ checkedInAt: { not: null } }),
      notCheckedIn: await count({ status: RsvpStatus.CONFIRMED, checkedInAt: null }),
    });

    const soloGuests = await listAttendeesPage(scope(), { status: "going", kind: "guests", team: "solo" }, options);
    const expected = await count({ status: RsvpStatus.CONFIRMED, userId: null, teamId: null });
    expect(soloGuests.counts!.going).toBe(expected);
    expect(soloGuests.rows.every((row) => row.status === "CONFIRMED" && !row.user && !row.team)).toBe(true);
    expect(soloGuests.total).toBe(first.total);

    const users = await listAttendeesPage(scope(), { kind: "users" }, options);
    expect(users.counts!.all).toBe(2);
    expect(users.counts!.checkedIn).toBe(1);
  });

  it("searches past the first page: names, emails and team names, inside this event only", async () => {
    const byName = await listAttendeesPage(scope(), { query: "ada needle" }, options);
    expect(byName.rows.map((row) => row.guestName)).toEqual(["Ada Needle"]);
    expect(byName.counts!.all).toBe(1);

    const team = await prisma.team.findFirstOrThrow({ where: { eventId: event.id, name: "Team 00 Beta" }, include: { _count: { select: { members: true } } } });
    const byTeam = await listAttendeesPage(scope(), { query: "team 00 beta" }, options);
    expect(byTeam.rows).toHaveLength(team._count.members);
    expect(byTeam.rows.every((row) => row.team?.id === team.id)).toBe(true);

    const byEmail = await listAttendeesPage(scope(), { query: `signed-in-b-${suffix}` }, options);
    expect(byEmail.rows.map((row) => row.user?.email)).toEqual([`signed-in-b-${suffix}@example.test`]);

    // LIKE wildcards are literal.
    expect((await listAttendeesPage(scope(), { query: "%" }, options)).rows).toEqual([]);
  });

  it("returns nothing for a scope outside its organisation or a forged cursor", async () => {
    const forged = await listAttendeesPage({ kind: "event", eventId: event.id, organisationId: otherOrganisationId }, {}, options);
    expect(forged.rows).toEqual([]);
    expect(forged.total).toBe(0);
    expect(forged.counts!.all).toBe(0);
    expect((await listAttendeesPage(scope(), { cursor: "1.x' OR 1=1" }, options)).rows).toEqual([]);
  });

  it("checks registration management in loadAttendeesPage", async () => {
    session.userId = adminId;
    const ok = await loadAttendeesPage({ organisationSlug: orgSlug, eventId: event.id, status: "checkedIn" });
    expect(ok.ok && ok.data!.rows.every((row) => row.checkedInAt)).toBe(true);
    session.userId = memberId;
    expect(await loadAttendeesPage({ organisationSlug: orgSlug, eventId: event.id })).toMatchObject({ ok: false });
    session.userId = checkInHelperId;
    expect(await loadAttendeesPage({ organisationSlug: orgSlug, eventId: event.id })).toMatchObject({ ok: false });
    session.userId = otherAdminId;
    expect(await loadAttendeesPage({ organisationSlug: otherOrgSlug, eventId: event.id })).toMatchObject({ ok: false });
    expect(await loadAttendeesPage({ organisationSlug: orgSlug, eventId: event.id })).toMatchObject({ ok: false });
    session.userId = null;
    expect(await loadAttendeesPage({ organisationSlug: orgSlug, eventId: event.id })).toMatchObject({ ok: false });
  });

  it("exports emails for every guest matching the filters, not just a loaded page", async () => {
    const request = (query: string) => new Request(`https://events.example.test/api/exports/events/${event.id}/attendee-emails?${query}`);
    const params = { params: Promise.resolve({ eventId: event.id }) };
    session.userId = adminId;
    const response = await exportEmails(request("status=going&team=team"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const lines = (await response.text()).replace(/^﻿/, "").trim().split("\n");
    const expected = await prisma.rSVP.count({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED, teamId: { not: null } } });
    expect(expected).toBeGreaterThan(ATTENDEES_PAGE_SIZE);
    expect(lines[0]).toBe("Name,Email");
    expect(lines).toHaveLength(expected + 1);

    session.userId = memberId;
    expect((await exportEmails(request(""), params)).status).toBe(404);
    session.userId = otherAdminId;
    expect((await exportEmails(request(""), params)).status).toBe(404);
    session.userId = adminId;
    expect((await exportEmails(request("status=nope"), params)).status).toBe(404);
    session.userId = null;
  });
});

describe("Move to team picker", () => {
  it("pages every team with room alphabetically, and never a full, declined or current team", async () => {
    const all = await prisma.team.findMany({
      where: { eventId: event.id },
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
      include: { _count: { select: { members: true } } },
    });
    const withRoom = all.filter((team) => team.status !== RsvpStatus.REJECTED && team._count.members < 3);
    const exclude = withRoom[0]!;
    const { rows, pages } = await walk(async (cursor) => {
      const page = await listTeamMoveTargetsForOrganiser(organiser, { cursor, excludeTeamId: exclude.id });
      return { rows: page.teams, nextCursor: page.nextCursor };
    }, TEAM_MOVE_TARGETS_PAGE_SIZE);
    expect(pages).toBeGreaterThan(1);
    expect(rows.map((team) => team.id)).toEqual(withRoom.slice(1).map((team) => team.id));
    expect(rows.every((team) => team.size < 3 && team.maxSize === 3)).toBe(true);
  });

  it("searches names in this event only", async () => {
    const found = await listTeamMoveTargetsForOrganiser(organiser, { query: "00 beta" });
    const team = await prisma.team.findFirstOrThrow({ where: { eventId: event.id, name: "Team 00 Beta" }, include: { _count: { select: { members: true } } } });
    expect(found.teams.map((row) => row.id)).toEqual(team._count.members < 3 ? [team.id] : []);
    expect((await listTeamMoveTargetsForOrganiser(organiser, { query: "zulu" })).teams).toEqual([]);
    expect((await listTeamMoveTargetsForOrganiser({ ...organiser, organisationId: otherOrganisationId }, {})).teams).toEqual([]);
    expect((await listTeamMoveTargetsForOrganiser(organiser, { cursor: "garbage!" })).teams).toEqual([]);
  });

  it("checks the organiser in searchMoveTargets", async () => {
    session.userId = adminId;
    const ok = await searchMoveTargets({ organisationSlug: orgSlug, eventId: event.id });
    expect(ok.ok && ok.data!.teams.length).toBe(TEAM_MOVE_TARGETS_PAGE_SIZE);
    session.userId = memberId;
    expect(await searchMoveTargets({ organisationSlug: orgSlug, eventId: event.id })).toMatchObject({ ok: false });
    session.userId = otherAdminId;
    expect(await searchMoveTargets({ organisationSlug: otherOrgSlug, eventId: event.id })).toMatchObject({ ok: false });
    session.userId = null;
  });
});

describe("invite pages", () => {
  beforeAll(async () => {
    await prisma.eventInvite.createMany({ data: Array.from({ length: 120 }, (_, i) => ({
      eventId: event.id,
      email: `invitee-${String(i).padStart(3, "0")}-${i % 10 === 0 ? "vip" : "std"}@example.test`,
      createdAt: i < 5 ? minutes(0) : minutes(i),
    })) });
    await prisma.eventInvite.create({ data: { eventId: otherEvent.id, email: "invitee-000-vip@example.test" } });
  });

  it("numbers pages over a stable order with totals", async () => {
    const expected = await prisma.eventInvite.findMany({ where: { eventId: event.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const result = await listEventInvitesPage({ eventId: event.id, organisationId }, { page });
      expect(result).toMatchObject({ page, pageCount: 3, total: 120, matching: 120, pageSize: INVITES_PAGE_SIZE });
      seen.push(...result.invites.map((invite) => invite.id));
    }
    expect(seen).toEqual(expected.map((invite) => invite.id));
    // Past the end shows the last page.
    expect((await listEventInvitesPage({ eventId: event.id, organisationId }, { page: 9 })).page).toBe(3);
  });

  it("searches by email on the server and keeps the badge total", async () => {
    const result = await listEventInvitesPage({ eventId: event.id, organisationId }, { query: "VIP" });
    expect(result).toMatchObject({ total: 120, matching: 12, page: 1, pageCount: 1 });
    expect(result.invites.every((invite) => invite.email.includes("vip"))).toBe(true);
    expect((await listEventInvitesPage({ eventId: event.id, organisationId: otherOrganisationId }, {})).total).toBe(0);
  });

  it("checks MANAGE_INVITATIONS in loadInvitesPage", async () => {
    session.userId = inviterId;
    const ok = await loadInvitesPage({ organisationSlug: orgSlug, eventId: event.id, page: 2 });
    expect(ok.ok && ok.data!.invites.length).toBe(INVITES_PAGE_SIZE);
    session.userId = checkInHelperId;
    expect(await loadInvitesPage({ organisationSlug: orgSlug, eventId: event.id })).toMatchObject({ ok: false });
    session.userId = otherAdminId;
    expect(await loadInvitesPage({ organisationSlug: otherOrgSlug, eventId: event.id })).toMatchObject({ ok: false });
    session.userId = null;
  });
});

describe("check-in desk paging", () => {
  it("walks every check-in once, newest first", async () => {
    // Two more check-ins at an identical time exercise the id tie-break.
    const tied = await prisma.rSVP.findMany({ where: { eventId: event.id, checkedInAt: null, status: RsvpStatus.CONFIRMED }, take: 2, select: { id: true } });
    await prisma.rSVP.updateMany({ where: { id: { in: tied.map((row) => row.id) } }, data: { checkedInAt: minutes(5000) } });
    const expected = await prisma.rSVP.findMany({ where: { eventId: event.id, checkedInAt: { not: null } }, orderBy: [{ checkedInAt: "desc" }, { id: "desc" }], select: { id: true } });
    expect(expected.length).toBeGreaterThan(RECENT_CHECK_INS_PAGE_SIZE);
    const { rows } = await walk((cursor) => listRecentCheckIns(event.id, cursor), RECENT_CHECK_INS_PAGE_SIZE);
    expect(rows.map((row) => row.rsvpId)).toEqual(expected.map((row) => row.id));
    expect(Object.keys(rows[0]!).sort()).toEqual(["checkedInAt", "displayName", "email", "rsvpId"]);
    expect((await listRecentCheckIns(otherEvent.id)).rows).toEqual([]);
  });

  it("checks CHECK_IN in loadRecentCheckIns", async () => {
    const first = await listRecentCheckIns(event.id);
    session.userId = checkInHelperId;
    const ok = await loadRecentCheckIns({ organisationSlug: orgSlug, eventId: event.id, cursor: first.nextCursor });
    expect(ok.ok && ok.data!.rows[0]!.rsvpId).not.toBe(first.rows[0]!.rsvpId);
    session.userId = inviterId;
    expect(await loadRecentCheckIns({ organisationSlug: orgSlug, eventId: event.id })).toMatchObject({ ok: false });
    session.userId = otherAdminId;
    expect(await loadRecentCheckIns({ organisationSlug: otherOrgSlug, eventId: event.id })).toMatchObject({ ok: false });
    session.userId = null;
  });
});

describe("check-in list roster paging", () => {
  let list: { id: string; requiresEntryCheckIn: boolean };

  beforeAll(async () => {
    list = await prisma.checkInList.create({ data: { eventId: event.id, name: "Swag", sortOrder: 0 }, select: { id: true, requiresEntryCheckIn: true } });
    const confirmed = await prisma.rSVP.findMany({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED }, orderBy: { id: "asc" }, select: { id: true } });
    const waitlisted = await prisma.rSVP.findFirstOrThrow({ where: { eventId: event.id, status: RsvpStatus.WAITLISTED }, select: { id: true } });
    const collected = [...confirmed.filter((_, i) => i % 3 === 0), waitlisted];
    await prisma.checkInListRecord.createMany({ data: collected.map((row, i) => ({ listId: list.id, rsvpId: row.id, source: "online", checkedInAt: minutes(3000 + i) })) });
  });

  it("pages, filters and counts the whole roster on the server", async () => {
    const confirmed = await prisma.rSVP.count({ where: { eventId: event.id, status: RsvpStatus.CONFIRMED } });
    const collected = await prisma.checkInListRecord.count({ where: { listId: list.id } });
    const collectedConfirmed = await prisma.checkInListRecord.count({ where: { listId: list.id, rsvp: { status: RsvpStatus.CONFIRMED } } });
    const first = await loadCheckInListRosterPage(event.id, list);
    expect(first.counts).toEqual({ all: confirmed + (collected - collectedConfirmed), collected, notCollected: confirmed - collectedConfirmed });
    expect(first.counts!.all).toBeGreaterThan(LIST_ROSTER_PAGE_SIZE);

    for (const filter of ["all", "collected", "notCollected"] as const) {
      const { rows } = await walk((cursor) => loadCheckInListRosterPage(event.id, list, { filter, cursor }), LIST_ROSTER_PAGE_SIZE);
      expect(new Set(rows.map((row) => row.rsvpId)).size).toBe(rows.length);
      expect(rows.length).toBe(first.counts![filter]);
      if (filter === "collected") expect(rows.every((row) => row.listCheckedInAt)).toBe(true);
      if (filter === "notCollected") expect(rows.every((row) => !row.listCheckedInAt && row.status === "CONFIRMED")).toBe(true);
    }

    const searched = await loadCheckInListRosterPage(event.id, list, { query: "signed-in-a" });
    expect(searched.rows).toHaveLength(1);
    expect(searched.counts!.all).toBe(1);
  });

  it("checks CHECK_IN and the list's event in loadListRosterPage", async () => {
    session.userId = checkInHelperId;
    const ok = await loadListRosterPage({ organisationSlug: orgSlug, eventId: event.id, listId: list.id, filter: "collected" });
    expect(ok.ok && ok.data!.rows.every((row) => row.listCheckedInAt)).toBe(true);
    session.userId = inviterId;
    expect(await loadListRosterPage({ organisationSlug: orgSlug, eventId: event.id, listId: list.id })).toMatchObject({ ok: false });
    session.userId = otherAdminId;
    expect(await loadListRosterPage({ organisationSlug: otherOrgSlug, eventId: otherEvent.id, listId: list.id })).toMatchObject({ ok: false, error: "List not found." });
    session.userId = null;
  });
});
