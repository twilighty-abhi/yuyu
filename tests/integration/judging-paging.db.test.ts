import { randomUUID } from "node:crypto";
import { EventPermission, EventStatus, MembershipRole, RegistrationMode, RsvpStatus, SoloPolicy, SubmissionStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { resolveJudgeContext, type JudgeContext } from "@/lib/judgingAccess";
import { listJudgeSubmissionsPage, listSubmissionsForJudge, loadProjectGallery, loadPublicResults } from "@/lib/core/judging";
import { JUDGE_SUBMISSIONS_PAGE_SIZE, PROJECT_GALLERY_PAGE_SIZE, type JudgeSubmissionFilter } from "@/lib/judgingPaging";

/*
 * Paging for the judge workspace list and the public project gallery
 * (docs/HACKATHON.md): every page bounded, a stable order across pages with
 * ties on `submittedAt`, totals from separate counts, filters and search
 * applied in SQL, and the visibility rules (event, status, assignment,
 * conflict of interest) unchanged.
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `jpaging-${suffix}`;
const HOUR = 3_600_000;
const base = Date.UTC(2030, 0, 1, 9, 0, 0, 0);
const SOLO_COUNT = 60;

let organisationId = "";
const userIds: string[] = [];
let ownerId = "";
let judgeId = "";
let conflictedJudgeId = "";
let outsiderId = "";
let soloJudgeId = "";
let event: Event;
let otherEvent: Event;
/** Every SUBMITTED submission of `event`, in display order. */
let expectedOrder: string[] = [];
let reviewedIds: string[] = [];
let inProgressIds: string[] = [];
let conflictSoloId = "";
let conflictTeamSubmissionId = "";

async function createEvent(label: string): Promise<Event> {
  return prisma.event.create({
    data: {
      organisationId,
      title: `Paging ${label} ${suffix}`,
      slug: `jpaging-${label}-${suffix}`,
      startDateTime: new Date(Date.now() - 48 * HOUR),
      endDateTime: new Date(Date.now() - 24 * HOUR),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      registrationMode: RegistrationMode.TEAM,
      teamMaxSize: 4,
      soloPolicy: SoloPolicy.SOLO_ALLOWED,
      submissionsEnabled: true,
      submissionsOpenAt: new Date(Date.now() - 4 * HOUR),
      submissionsCloseAt: new Date(Date.now() - HOUR),
      judgesSeeAll: true,
      projectGalleryPublic: true,
      page: { create: { isPublished: true } },
    },
  });
}

async function soloEntrant(target: Event, name: string, userId: string | null = null) {
  return prisma.rSVP.create({
    data: {
      eventId: target.id,
      userId,
      guestName: userId ? null : name,
      guestEmail: userId ? null : `${randomUUID()}@example.test`,
      attendeeKey: userId ? `user:${userId}` : `guest:${randomUUID()}@example.test`,
      status: RsvpStatus.CONFIRMED,
    },
  });
}

async function teamEntrant(target: Event, name: string, memberUserId: string | null = null) {
  const team = await prisma.team.create({
    data: { eventId: target.id, name, nameKey: name.toLowerCase(), status: RsvpStatus.CONFIRMED, joinToken: randomUUID(), manageTokenHash: randomUUID() },
  });
  await prisma.rSVP.create({
    data: {
      eventId: target.id,
      teamId: team.id,
      userId: memberUserId,
      guestName: memberUserId ? null : `${name} Lead`,
      guestEmail: memberUserId ? null : `${randomUUID()}@example.test`,
      attendeeKey: memberUserId ? `user:${memberUserId}` : `guest:${randomUUID()}@example.test`,
      status: RsvpStatus.CONFIRMED,
    },
  });
  return team;
}

async function judgeCtx(userId: string, eventId = event.id): Promise<JudgeContext> {
  const ctx = await resolveJudgeContext(userId, orgSlug, eventId);
  if (!ctx) throw new Error("judge context missing");
  return ctx;
}

/** Walk "Load more" to the end and return every id, checking each page's bound. */
async function walk(ctx: JudgeContext, filter: JudgeSubmissionFilter, query = ""): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 50; guard++) {
    const page = await listJudgeSubmissionsPage(ctx, { filter, query, cursor });
    if (!page) throw new Error("page missing");
    expect(page.submissions.length).toBeLessThanOrEqual(JUDGE_SUBMISSIONS_PAGE_SIZE);
    if (page.nextCursor) expect(page.submissions).toHaveLength(JUDGE_SUBMISSIONS_PAGE_SIZE);
    ids.push(...page.submissions.map((row) => row.id));
    if (!page.nextCursor) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("paging did not end");
}

describe.sequential("judging paging integration", () => {
  beforeAll(async () => {
    const org = await prisma.organisation.create({ data: { name: `Paging ${suffix}`, slug: orgSlug } });
    organisationId = org.id;
    const users = await Promise.all(
      ["owner", "judge", "conflicted", "outsider", "solojudge"].map((label) =>
        prisma.user.create({ data: { name: `${label} User`, email: `${label}-${suffix}@example.test`, emailVerified: new Date() } }),
      ),
    );
    [ownerId, judgeId, conflictedJudgeId, outsiderId, soloJudgeId] = users.map((user) => user.id) as [string, string, string, string, string];
    userIds.push(...users.map((user) => user.id));
    await prisma.membership.create({ data: { userId: ownerId, organisationId, role: MembershipRole.OWNER } });
    await prisma.membership.create({ data: { userId: outsiderId, organisationId, role: MembershipRole.MEMBER } });

    event = await createEvent("main");
    otherEvent = await createEvent("other");
    for (const userId of [judgeId, conflictedJudgeId, soloJudgeId]) {
      await prisma.eventCollaborator.create({ data: { eventId: event.id, userId, permissions: [EventPermission.JUDGE] } });
    }
    const criterion = await prisma.judgingCriterion.create({ data: { eventId: event.id, name: "Impact", weight: 1, maxScore: 5, position: 0 } });

    // 60 solo projects; three share each submission time, so the order relies on the id tie-break.
    const rows: Array<{ id: string; submittedAt: Date }> = [];
    for (let index = 0; index < SOLO_COUNT; index++) {
      const rsvp = await soloEntrant(event, `Person${index} Surname${index}`);
      const submittedAt = new Date(base + Math.floor(index / 3) * 60_000);
      const submission = await prisma.submission.create({
        data: { eventId: event.id, rsvpId: rsvp.id, title: index === 7 ? "100% Solar_Car" : `Project ${index}`, summary: "Summary", status: SubmissionStatus.SUBMITTED, submittedAt },
      });
      rows.push({ id: submission.id, submittedAt });
    }
    // Two team projects, the second from a team the conflicted judge is in.
    const rocket = await teamEntrant(event, `Rocket Crew ${suffix.slice(0, 6)}`);
    const rocketSubmission = await prisma.submission.create({
      data: { eventId: event.id, teamId: rocket.id, title: "Launcher", status: SubmissionStatus.SUBMITTED, submittedAt: new Date(base + 5 * 60_000) },
    });
    rows.push({ id: rocketSubmission.id, submittedAt: new Date(base + 5 * 60_000) });
    const conflictTeam = await teamEntrant(event, `Judges Own ${suffix.slice(0, 6)}`, conflictedJudgeId);
    const conflictTeamSubmission = await prisma.submission.create({
      data: { eventId: event.id, teamId: conflictTeam.id, title: "Own team", status: SubmissionStatus.SUBMITTED, submittedAt: new Date(base + 6 * 60_000) },
    });
    conflictTeamSubmissionId = conflictTeamSubmission.id;
    rows.push({ id: conflictTeamSubmission.id, submittedAt: new Date(base + 6 * 60_000) });
    // A solo project from the solo judge's own registration.
    const ownSolo = await soloEntrant(event, "Solo Judge", soloJudgeId);
    const ownSoloSubmission = await prisma.submission.create({
      data: { eventId: event.id, rsvpId: ownSolo.id, title: "Judge solo", status: SubmissionStatus.SUBMITTED, submittedAt: new Date(base + 7 * 60_000) },
    });
    conflictSoloId = ownSoloSubmission.id;
    rows.push({ id: ownSoloSubmission.id, submittedAt: new Date(base + 7 * 60_000) });

    // Not visible anywhere: drafts, withdrawn, disqualified.
    for (const [index, status] of ([SubmissionStatus.DRAFT, SubmissionStatus.WITHDRAWN, SubmissionStatus.DISQUALIFIED] as const).entries()) {
      const rsvp = await soloEntrant(event, `Hidden${index} Person`);
      await prisma.submission.create({
        data: { eventId: event.id, rsvpId: rsvp.id, title: `Hidden ${status}`, status, submittedAt: status === SubmissionStatus.DISQUALIFIED ? new Date(base) : null },
      });
    }
    // Another event's projects never leak in.
    for (let index = 0; index < 5; index++) {
      const rsvp = await soloEntrant(otherEvent, `Other${index} Person`);
      await prisma.submission.create({ data: { eventId: otherEvent.id, rsvpId: rsvp.id, title: `Other ${index}`, status: SubmissionStatus.SUBMITTED, submittedAt: new Date(base) } });
    }

    expectedOrder = rows
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => row.id);

    // The judge reviewed 10 projects and part-scored 5 others.
    reviewedIds = expectedOrder.slice(0, 30).filter((_, index) => index % 3 === 0);
    inProgressIds = expectedOrder.slice(40, 45);
    for (const submissionId of reviewedIds) {
      await prisma.judgeScore.create({ data: { submissionId, judgeUserId: judgeId, criterionId: criterion.id, score: 4 } });
      await prisma.judgeReview.create({ data: { submissionId, judgeUserId: judgeId, submittedAt: new Date() } });
    }
    for (const submissionId of inProgressIds) {
      await prisma.judgeScore.create({ data: { submissionId, judgeUserId: judgeId, criterionId: criterion.id, score: 2 } });
      // A saved, unsubmitted comment is still "in progress".
      await prisma.judgeReview.create({ data: { submissionId, judgeUserId: judgeId, comment: "draft" } });
    }
  });

  afterAll(async () => {
    if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("pages the judge's whole list in a stable order with no gaps or repeats", async () => {
    const ctx = await judgeCtx(judgeId);
    const first = await listSubmissionsForJudge(ctx);
    expect(first?.submissions).toHaveLength(JUDGE_SUBMISSIONS_PAGE_SIZE);
    expect(first?.nextCursor).toBeTruthy();
    expect(first?.counts).toEqual({ all: expectedOrder.length, reviewed: 10, in_progress: 5, todo: expectedOrder.length - 10 });
    expect(JSON.stringify(first)).not.toMatch(/@example\.test|Surname|draft/);

    const all = await walk(ctx, "all");
    expect(all).toEqual(expectedOrder);
    expect(new Set(all).size).toBe(all.length);
  });

  it("filters by the judge's own progress in SQL", async () => {
    const ctx = await judgeCtx(judgeId);
    expect(await walk(ctx, "reviewed")).toEqual(reviewedIds);
    expect(await walk(ctx, "in_progress")).toEqual(inProgressIds);
    const todo = await walk(ctx, "todo");
    expect(todo).toEqual(expectedOrder.filter((id) => !reviewedIds.includes(id)));
    // Another judge's progress is their own.
    const owner = await judgeCtx(ownerId);
    const ownerPage = await listJudgeSubmissionsPage(owner, { filter: "reviewed" });
    expect(ownerPage?.submissions).toEqual([]);
    expect(ownerPage?.counts).toMatchObject({ reviewed: 0, todo: expectedOrder.length });
  });

  it("searches titles, team names, and first names only, with wildcards literal", async () => {
    const ctx = await judgeCtx(judgeId);
    const titles = async (query: string) => (await listJudgeSubmissionsPage(ctx, { query }))?.submissions.map((row) => row.title);
    expect(await titles("100%")).toEqual(["100% Solar_Car"]);
    expect(await titles("t_1")).toEqual([]);
    expect(await titles("rocket crew")).toEqual(["Launcher"]);
    expect(await titles("person12")).toEqual(["Project 12"]);
    // The surname is never shown, so it is never matched.
    expect(await titles("Surname12")).toEqual([]);
    // The search narrows the list but the totals still cover everything.
    expect((await listJudgeSubmissionsPage(ctx, { query: "Project 1" }))?.counts.all).toBe(expectedOrder.length);
    expect(await walk(ctx, "all", "Project")).toHaveLength(SOLO_COUNT - 1);
  });

  it("keeps conflict of interest, assignments, and event scoping in the query", async () => {
    const conflicted = await judgeCtx(conflictedJudgeId);
    const visible = await walk(conflicted, "all");
    expect(visible).not.toContain(conflictTeamSubmissionId);
    expect(visible).toHaveLength(expectedOrder.length - 1);
    expect((await listSubmissionsForJudge(conflicted))?.counts.all).toBe(expectedOrder.length - 1);
    const soloJudge = await judgeCtx(soloJudgeId);
    const soloVisible = await walk(soloJudge, "all");
    expect(soloVisible).toEqual(expectedOrder.filter((id) => id !== conflictSoloId));
    expect((await listSubmissionsForJudge(soloJudge))?.counts.all).toBe(expectedOrder.length - 1);
    expect(await walk(await judgeCtx(judgeId), "all")).toContain(conflictSoloId);

    // Assigned-only judging: just the assigned projects, still paged and filtered.
    await prisma.event.update({ where: { id: event.id }, data: { judgesSeeAll: false } });
    try {
      const assigned = [expectedOrder[3]!, expectedOrder[0]!, expectedOrder[50]!];
      for (const submissionId of assigned) await prisma.judgeAssignment.create({ data: { eventId: event.id, judgeUserId: judgeId, submissionId } });
      const ctx = await judgeCtx(judgeId);
      expect(await walk(ctx, "all")).toEqual([expectedOrder[0], expectedOrder[3], expectedOrder[50]]);
      expect((await listSubmissionsForJudge(ctx))?.counts).toEqual({ all: 3, reviewed: 2, in_progress: 0, todo: 1 });
      expect(await walk(ctx, "todo")).toEqual([expectedOrder[50]]);
    } finally {
      await prisma.judgeAssignment.deleteMany({ where: { eventId: event.id } });
      await prisma.event.update({ where: { id: event.id }, data: { judgesSeeAll: true } });
    }

    // A non-judge, a forged context, or another organisation's scope gets nothing.
    expect(await listJudgeSubmissionsPage({ ...(await judgeCtx(judgeId)), userId: outsiderId }, {})).toBeNull();
    expect(await listJudgeSubmissionsPage({ ...(await judgeCtx(judgeId)), organisationId: "c".repeat(25) }, {})).toBeNull();
    expect(await listJudgeSubmissionsPage({ ...(await judgeCtx(judgeId)), eventId: otherEvent.id }, {})).toBeNull();
    // A forged cursor or input gives an empty page, never another event's rows.
    const ctx = await judgeCtx(judgeId);
    expect((await listJudgeSubmissionsPage(ctx, { cursor: "not-a-cursor" }))?.submissions).toEqual([]);
    expect((await listJudgeSubmissionsPage(ctx, { filter: "everything" }))?.submissions).toEqual([]);
    expect((await listJudgeSubmissionsPage(ctx, { eventId: otherEvent.id }))?.submissions).toEqual([]);
  });

  it("pages the public gallery by number with accurate totals", async () => {
    const totalPages = Math.ceil(expectedOrder.length / PROJECT_GALLERY_PAGE_SIZE);
    const seen: string[] = [];
    for (let page = 1; page <= totalPages; page++) {
      const gallery = await loadProjectGallery(event.id, undefined, { page });
      expect(gallery).toMatchObject({ total: expectedOrder.length, matched: expectedOrder.length, page, totalPages, pageSize: PROJECT_GALLERY_PAGE_SIZE, query: "" });
      expect(gallery!.projects.length).toBe(page < totalPages ? PROJECT_GALLERY_PAGE_SIZE : expectedOrder.length - (totalPages - 1) * PROJECT_GALLERY_PAGE_SIZE);
      seen.push(...gallery!.projects.map((project) => project.id));
    }
    expect(seen).toEqual(expectedOrder);

    // Out-of-range pages clamp; default is page 1.
    expect((await loadProjectGallery(event.id, undefined, { page: 99 }))?.page).toBe(totalPages);
    expect((await loadProjectGallery(event.id, undefined, { page: 0 }))?.page).toBe(1);
    expect((await loadProjectGallery(event.id))?.projects.map((project) => project.id)).toEqual(expectedOrder.slice(0, PROJECT_GALLERY_PAGE_SIZE));

    // Search: server-side, with its own count and pages; totals still report everything.
    const searched = await loadProjectGallery(event.id, undefined, { query: "  rocket   crew " });
    expect(searched).toMatchObject({ total: expectedOrder.length, matched: 1, totalPages: 1, query: "rocket crew" });
    expect(searched?.projects.map((project) => project.title)).toEqual(["Launcher"]);
    const projects = await loadProjectGallery(event.id, undefined, { query: "Project", page: 3 });
    expect(projects).toMatchObject({ matched: SOLO_COUNT - 1, page: 3, totalPages: 3 });
    expect(await loadProjectGallery(event.id, undefined, { query: "Surname3" })).toMatchObject({ matched: 0, projects: [] });

    // The DTO stays public-safe.
    const text = JSON.stringify(await loadProjectGallery(event.id, undefined, { page: 2 }));
    expect(text).not.toMatch(/@example\.test|Surname|"score"|submittedAt|rsvpId|teamId/);
    expect(text).not.toMatch(/Hidden|Other \d/);

    // Not visible: null before any project is read.
    await prisma.event.update({ where: { id: event.id }, data: { projectGalleryPublic: false } });
    try {
      expect(await loadProjectGallery(event.id, undefined, { page: 2, query: "Project" })).toBeNull();
    } finally {
      await prisma.event.update({ where: { id: event.id }, data: { projectGalleryPublic: true } });
    }
  });

  it("keeps every winner on the public results page", async () => {
    const award = await prisma.eventAward.create({ data: { eventId: event.id, name: "Overall", position: 0 } });
    for (const [index, submissionId] of expectedOrder.slice(0, 20).entries()) {
      await prisma.eventAwardWinner.create({ data: { awardId: award.id, submissionId, place: index + 1 } });
    }
    await prisma.event.update({ where: { id: event.id }, data: { resultsPublishedAt: new Date() } });
    const results = await loadPublicResults(event.id);
    expect(results?.awards[0]?.winners.map((winner) => winner.place)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });
});
