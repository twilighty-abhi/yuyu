import { randomUUID } from "node:crypto";
import { EventPermission, EventPrivacyType, EventStatus, MembershipRole, RegistrationMode, RsvpStatus, SubmissionStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: null as string | null }));
const audit = vi.hoisted(() => ({ events: [] as Array<{ action: string; metadata?: Record<string, unknown> }> }));
vi.mock("@/lib/auth", () => ({ auth: async () => (session.userId ? { user: { id: session.userId } } : null) }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: async (event: { action: string; metadata?: Record<string, unknown> }) => void audit.events.push(event) }));
vi.mock("@/lib/publicUrl", () => ({ getRequestOrigin: async () => "https://events.example.test" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { GET as exportAttendees } from "@/app/api/exports/events/[eventId]/attendees/route";
import { GET as exportTeams } from "@/app/api/exports/events/[eventId]/teams/route";
import { GET as exportJudging } from "@/app/api/exports/events/[eventId]/judging/route";
import { loadFeedbackResponsesPage } from "@/app/actions/feedback-form";
import { FEEDBACK_RESPONSES_PAGE_SIZE } from "@/lib/eventDashboard/feedbackResponses";

/*
 * Filtered CSV exports (Guests · People, Guests · Teams, Judging →
 * Submissions and Results) and the paged feedback responses: each export
 * holds exactly the rows its screen's filters match, across more than one
 * server batch, in the same access as the screen, with formula-safe cells;
 * every denial is an empty 404.
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `exports-${suffix}`;
const otherOrgSlug = `exports-other-${suffix}`;
const TEAMS = 210;
const SOLOS = 520;
let organisationId = "";
let otherOrganisationId = "";
let adminId = "";
let memberId = "";
let registrarId = "";
let otherAdminId = "";
let event: Event;
let otherEvent: Event;

const base = new Date("2030-03-01T09:00:00.000Z");
const minutes = (n: number) => new Date(base.getTime() + n * 60_000);
const squad = (i: number) => `Squad ${String(i).padStart(3, "0")}`;
const FORMULA_TEAM = '=HYPERLINK("https://evil.example")';

/** A small RFC 4180 reader for the response bodies. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]!;
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function csv(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const [header, ...rows] = parseCsv(await response.text());
  return { header: header!, rows };
}

function request(path: string, query = "") {
  return new Request(`https://events.example.test/api/exports/events/${event.id}/${path}${query ? `?${query}` : ""}`);
}
const ctxFor = (target: Event) => ({ params: Promise.resolve({ eventId: target.id }) });

async function expectBare404(response: Response) {
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("");
}

beforeAll(async () => {
  const [org, otherOrg] = await Promise.all([
    prisma.organisation.create({ data: { name: `Exports ${suffix}`, slug: orgSlug } }),
    prisma.organisation.create({ data: { name: `Exports other ${suffix}`, slug: otherOrgSlug } }),
  ]);
  organisationId = org.id;
  otherOrganisationId = otherOrg.id;
  const users = await Promise.all(
    ["admin", "member", "registrar", "other-admin"].map((label) => prisma.user.create({ data: { name: `Exports ${label}`, email: `${label}-${suffix}@example.test` } })),
  );
  [adminId, memberId, registrarId, otherAdminId] = users.map((user) => user.id) as [string, string, string, string];
  await prisma.membership.createMany({ data: [
    { userId: adminId, organisationId, role: MembershipRole.OWNER },
    { userId: memberId, organisationId, role: MembershipRole.MEMBER },
    { userId: otherAdminId, organisationId: otherOrganisationId, role: MembershipRole.ADMIN },
  ] });
  const eventData = (organisation: string) => ({
    organisationId: organisation,
    title: `Exports ${suffix}`,
    slug: `exports-${suffix}-${randomUUID().slice(0, 8)}`,
    startDateTime: new Date("2035-01-01T10:00:00.000Z"),
    endDateTime: new Date("2035-01-02T10:00:00.000Z"),
    timezone: "UTC",
    status: EventStatus.PUBLISHED,
    privacyType: EventPrivacyType.PUBLIC,
    registrationMode: RegistrationMode.TEAM,
    teamMinSize: 2,
    teamMaxSize: 4,
    submissionsEnabled: true,
    page: { create: { isPublished: true } },
  });
  event = await prisma.event.create({ data: eventData(organisationId) });
  otherEvent = await prisma.event.create({ data: eventData(otherOrganisationId) });
  // The registrar holds MANAGE_REGISTRATIONS on this event only (not a member).
  await prisma.eventCollaborator.create({ data: { eventId: event.id, userId: registrarId, permissions: [EventPermission.MANAGE_REGISTRATIONS] } });

  // 210 teams (more than one 200-team export batch) plus a formula-named
  // one; every tenth waitlisted; every third has two members (complete).
  const teamRows = Array.from({ length: TEAMS }, (_, i) => ({
    id: `team-${suffix}-${i}`,
    eventId: event.id,
    name: squad(i),
    nameKey: squad(i).toLowerCase(),
    status: i % 10 === 0 ? RsvpStatus.WAITLISTED : RsvpStatus.CONFIRMED,
    joinToken: randomUUID(),
    manageTokenHash: randomUUID(),
    createdAt: minutes(i),
  }));
  teamRows.push({ id: `team-${suffix}-formula`, eventId: event.id, name: FORMULA_TEAM, nameKey: "formula", status: RsvpStatus.CONFIRMED, joinToken: randomUUID(), manageTokenHash: randomUUID(), createdAt: minutes(TEAMS) });
  await prisma.team.createMany({ data: teamRows });
  const members = teamRows.flatMap((team, i) =>
    Array.from({ length: i % 3 === 0 ? 2 : 1 }, (_, m) => ({
      eventId: event.id,
      teamId: team.id,
      status: team.status,
      guestName: `Member ${i}-${m}`,
      guestEmail: `member-${i}-${m}-${suffix}@example.test`,
      attendeeKey: `guest:member-${i}-${m}-${suffix}@example.test`,
      createdAt: minutes(1000 + i * 2 + m),
    })),
  );
  await prisma.rSVP.createMany({ data: members });
  await prisma.$executeRaw`
    UPDATE "Team" t SET "leaderRsvpId" = (SELECT r."id" FROM "RSVP" r WHERE r."teamId" = t."id" ORDER BY r."createdAt" ASC LIMIT 1)
    WHERE t."eventId" = ${event.id}`;

  // 520 solo registrations: more than one 500-row attendee batch.
  await prisma.rSVP.createMany({ data: Array.from({ length: SOLOS }, (_, i) => ({
    eventId: event.id,
    status: i % 4 === 0 ? RsvpStatus.WAITLISTED : RsvpStatus.CONFIRMED,
    guestName: i === 7 ? "Ada Needle" : `Solo ${i}`,
    guestEmail: `solo-${i}-${suffix}@example.test`,
    attendeeKey: `guest:solo-${i}-${suffix}@example.test`,
    createdAt: minutes(5000 + i),
  })) });

  // 205 projects (more than one 200-project batch): even ones submitted, odd drafts, one disqualified.
  await prisma.submission.createMany({ data: Array.from({ length: 205 }, (_, i) => ({
    eventId: event.id,
    teamId: `team-${suffix}-${i}`,
    title: i === 4 ? "@SUM(A1)" : `Project ${String(i).padStart(3, "0")}`,
    status: i === 2 ? SubmissionStatus.DISQUALIFIED : i % 2 === 0 ? SubmissionStatus.SUBMITTED : SubmissionStatus.DRAFT,
    submittedAt: i % 2 === 0 ? minutes(9000 + i) : null,
    disqualifiedReason: i === 2 ? "Late" : null,
    createdAt: minutes(9000 + i),
  })) });

  // Lookalike data in another organisation.
  await prisma.team.create({ data: { eventId: otherEvent.id, name: squad(1), nameKey: squad(1).toLowerCase(), status: RsvpStatus.CONFIRMED, joinToken: randomUUID(), manageTokenHash: randomUUID() } });
  await prisma.rSVP.create({ data: { eventId: otherEvent.id, guestName: "Ada Needle", guestEmail: `other-${suffix}@example.test`, attendeeKey: `guest:other-${suffix}@example.test` } });

  // 60 anonymous feedback responses (three pages of 25).
  const form = await prisma.eventFeedbackForm.create({ data: { eventId: event.id, isOpen: true } });
  const field = await prisma.eventFeedbackField.create({ data: { formId: form.id, key: "comment", label: "Comment", type: "TEXT", sortOrder: 0 } });
  for (let i = 0; i < 60; i += 1) {
    await prisma.eventFeedbackResponse.create({ data: {
      formId: form.id,
      certificateToken: null,
      submittedAt: minutes(20_000 + (i < 5 ? 0 : i)),
      answers: { create: [{ fieldId: field.id, fieldKey: "comment", fieldLabel: "Comment", fieldType: "TEXT", valueText: `Answer ${i}` }] },
    } });
  }
});

afterAll(async () => {
  session.userId = null;
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  if (otherOrganisationId) await prisma.organisation.delete({ where: { id: otherOrganisationId } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.test` } } });
});

beforeEach(() => {
  session.userId = adminId;
  audit.events.length = 0;
});

describe("Guests · People export", () => {
  it("keeps the unfiltered file and narrows it to exactly the list's filters", async () => {
    const all = await csv(await exportAttendees(request("attendees"), ctxFor(event)));
    expect(all.rows).toHaveLength(await prisma.rSVP.count({ where: { eventId: event.id } }));
    expect(all.header.slice(0, 5)).toEqual(["Name", "Email", "Status", "Team", "Team role"]);

    const waitlist = await csv(await exportAttendees(request("attendees", "status=waitlist"), ctxFor(event)));
    expect(waitlist.header).toEqual(all.header);
    expect(waitlist.rows).toHaveLength(await prisma.rSVP.count({ where: { eventId: event.id, status: RsvpStatus.WAITLISTED } }));
    expect(waitlist.rows.every((row) => row[2] === "WAITLISTED")).toBe(true);

    const solo = await csv(await exportAttendees(request("attendees", "team=solo&status=going"), ctxFor(event)));
    expect(solo.rows).toHaveLength(await prisma.rSVP.count({ where: { eventId: event.id, teamId: null, status: RsvpStatus.CONFIRMED } }));

    // The search stays inside this event: the other organisation's Ada is not exported.
    const needle = await csv(await exportAttendees(request("attendees", "q=ada%20needle"), ctxFor(event)));
    expect(needle.rows.map((row) => row[0])).toEqual(["Ada Needle"]);
    expect(audit.events.at(-1)).toMatchObject({ action: "ATTENDEE_LIST_EXPORTED", metadata: { surface: "people", filters: "search" } });
    expect(JSON.stringify(audit.events)).not.toMatch(/needle/i);
  });

  it("uses the attendee CSV's access and answers every denial with an empty 404", async () => {
    session.userId = registrarId;
    expect((await exportAttendees(request("attendees", "status=going"), ctxFor(event))).status).toBe(200);
    for (const userId of [memberId, otherAdminId]) {
      session.userId = userId;
      await expectBare404(await exportAttendees(request("attendees", "status=going"), ctxFor(event)));
    }
    session.userId = adminId;
    await expectBare404(await exportAttendees(request("attendees", "status=everyone"), ctxFor(event)));
    await expectBare404(await exportAttendees(request("attendees", `q=${"x".repeat(101)}`), ctxFor(event)));
    expect(audit.events).toHaveLength(1);
  });
});

describe("Guests · Teams export", () => {
  it("streams every matching team across batches, formula-safe, with the submission status", async () => {
    const all = await csv(await exportTeams(request("teams"), ctxFor(event)));
    expect(all.header).toEqual(["Team", "Status", "Size", "Incomplete", "Looking for members", "Leader", "Leader email", "Members", "Submission status", "Created"]);
    expect(all.rows).toHaveLength(TEAMS + 1);
    expect(new Set(all.rows.map((row) => row[0])).size).toBe(TEAMS + 1);
    expect(all.rows.at(-1)![0]).toBe(`'${FORMULA_TEAM}`);
    const first = all.rows.find((row) => row[0] === squad(0))!;
    expect(first).toMatchObject({ 1: "WAITLISTED", 2: "2", 3: "No", 5: "Member 0-0", 6: `member-0-0-${suffix}@example.test`, 8: "SUBMITTED" });
    expect(first[7]).toBe(`Member 0-0 <member-0-0-${suffix}@example.test>; Member 0-1 <member-0-1-${suffix}@example.test>`);
    expect(all.rows.find((row) => row[0] === squad(1))![8]).toBe("DRAFT");
    expect(all.rows.find((row) => row[0] === squad(209))![8]).toBe("None");

    const waitlist = await csv(await exportTeams(request("teams", "status=waitlist"), ctxFor(event)));
    expect(waitlist.rows).toHaveLength(TEAMS / 10);
    const incomplete = await csv(await exportTeams(request("teams", "status=incomplete"), ctxFor(event)));
    expect(incomplete.rows.every((row) => row[3] === "Yes")).toBe(true);
    expect(incomplete.rows).toHaveLength(all.rows.filter((row) => row[3] === "Yes").length);
    const searched = await csv(await exportTeams(request("teams", "q=squad%2001"), ctxFor(event)));
    expect(searched.rows.map((row) => row[0])).toEqual(Array.from({ length: 10 }, (_, i) => squad(10 + i)));
    expect(audit.events.at(-1)).toMatchObject({ action: "TEAM_LIST_EXPORTED", metadata: { surface: "teams", filters: "search" } });
  });

  it("uses the Teams view's access and answers every denial with an empty 404", async () => {
    session.userId = registrarId;
    expect((await exportTeams(request("teams"), ctxFor(event))).status).toBe(200);
    for (const userId of [memberId, otherAdminId, null]) {
      session.userId = userId;
      await expectBare404(await exportTeams(request("teams"), ctxFor(event)));
    }
    session.userId = adminId;
    await expectBare404(await exportTeams(request("teams", "status=checkedIn"), ctxFor(event)));
    await expectBare404(await exportTeams(new Request("https://events.example.test/x"), ctxFor(otherEvent)));
  });
});

describe("Judging exports", () => {
  it("exports Submissions under the view's status filter and search, across batches", async () => {
    const all = await csv(await exportJudging(request("judging", "view=submissions"), ctxFor(event)));
    expect(all.header.slice(0, 4)).toEqual(["Project", "Entrant", "Entry", "Status"]);
    expect(all.rows).toHaveLength(205);
    expect(all.rows.find((row) => row[1] === squad(4))![0]).toBe("'@SUM(A1)");
    expect(all.rows.find((row) => row[1] === squad(2))![11]).toBe("Late");
    expect(JSON.stringify(all.rows)).not.toMatch(/@example\.test/);

    const submitted = await csv(await exportJudging(request("judging", "view=submissions&status=SUBMITTED"), ctxFor(event)));
    expect(submitted.rows).toHaveLength(await prisma.submission.count({ where: { eventId: event.id, status: SubmissionStatus.SUBMITTED } }));
    const searched = await csv(await exportJudging(request("judging", "view=submissions&q=project%20010"), ctxFor(event)));
    expect(searched.rows.map((row) => row[0])).toEqual(["Project 010"]);
    expect(audit.events.at(-1)).toMatchObject({ action: "JUDGING_SUBMISSIONS_EXPORTED", metadata: { surface: "submissions", filters: "search" } });
  });

  it("exports Results under the search and the method shown, keeping ranks", async () => {
    const all = await csv(await exportJudging(request("judging"), ctxFor(event)));
    expect(all.header.slice(0, 5)).toEqual(["Rank", "Project", "Entrant", "Status", "Result score"]);
    expect(all.rows).toHaveLength(await prisma.submission.count({ where: { eventId: event.id, status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.DISQUALIFIED] } } }));
    const searched = await csv(await exportJudging(request("judging", "q=project%20010&method=ZSCORE"), ctxFor(event)));
    expect(searched.rows.map((row) => row[1])).toEqual(["Project 010"]);
    expect(audit.events.at(-1)).toMatchObject({ action: "JUDGING_SCORES_EXPORTED", metadata: { surface: "results", method: "ZSCORE", filters: "search", rows: 1 } });
  });

  it("stays owner/admin only and refuses malformed or cross-view parameters", async () => {
    for (const userId of [registrarId, memberId, otherAdminId]) {
      session.userId = userId;
      await expectBare404(await exportJudging(request("judging", "view=submissions"), ctxFor(event)));
      await expectBare404(await exportJudging(request("judging"), ctxFor(event)));
    }
    session.userId = adminId;
    await expectBare404(await exportJudging(request("judging", "method=MEDIAN"), ctxFor(event)));
    await expectBare404(await exportJudging(request("judging", "status=SUBMITTED"), ctxFor(event)));
    await expectBare404(await exportJudging(request("judging", "view=submissions&method=RAW"), ctxFor(event)));
    await expectBare404(await exportJudging(request("judging", "view=everything"), ctxFor(event)));
  });
});

describe("Feedback responses paging", () => {
  it("pages every response once, newest first, with stable numbers", async () => {
    const seen: string[] = [];
    let pageCount = 1;
    for (let page = 1; page <= pageCount; page += 1) {
      const res = await loadFeedbackResponsesPage({ organisationSlug: orgSlug, eventId: event.id, page });
      expect(res.ok).toBe(true);
      if (!res.ok || !res.data) return;
      pageCount = res.data.pageCount;
      expect(res.data.total).toBe(60);
      expect(res.data.responses.length).toBeLessThanOrEqual(FEEDBACK_RESPONSES_PAGE_SIZE);
      if (page === 1) expect(res.data.responses[0]).toMatchObject({ number: 60, answers: [{ label: "Comment", value: "Answer 59" }] });
      seen.push(...res.data.responses.map((response) => response.id));
    }
    expect(pageCount).toBe(3);
    expect(new Set(seen).size).toBe(60);
    // A page past the end shows the last page.
    const last = await loadFeedbackResponsesPage({ organisationSlug: orgSlug, eventId: event.id, page: 99 });
    expect(last.ok && last.data?.page).toBe(3);
    expect(last.ok && last.data?.responses.at(-1)?.number).toBe(1);
  });

  it("is organisation owner/admin only and scoped to the organisation", async () => {
    for (const userId of [memberId, registrarId, otherAdminId]) {
      session.userId = userId;
      expect((await loadFeedbackResponsesPage({ organisationSlug: orgSlug, eventId: event.id })).ok).toBe(false);
    }
    session.userId = otherAdminId;
    const crossed = await loadFeedbackResponsesPage({ organisationSlug: otherOrgSlug, eventId: event.id });
    expect(crossed).toEqual({ ok: false, error: "Event not found." });
    session.userId = adminId;
    expect((await loadFeedbackResponsesPage({ organisationSlug: orgSlug, eventId: event.id, page: 0 })).ok).toBe(false);
  });
});
