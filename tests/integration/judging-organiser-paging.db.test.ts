import { randomBytes, randomUUID } from "node:crypto";
import { EventPermission, EventStatus, JudgingStatus, MembershipRole, RegistrationMode, RsvpStatus, SoloPolicy, SubmissionStatus, type Event } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { resolveJudgingOrganiser, type JudgingOrganiserContext } from "@/lib/judgingAccess";
import {
  listSubmissionsForOrganiser,
  loadJudgeProgress,
  loadJudgingResults,
  loadJudgingResultsPage,
  loadJudgingSetup,
  searchAwardCandidates,
  type OrganiserSubmissionsPage,
} from "@/lib/core/judging";
import { AWARD_CANDIDATES_PAGE_SIZE, JUDGING_RESULTS_PAGE_SIZE, ORGANISER_SUBMISSIONS_PAGE_SIZE } from "@/lib/judgingOrganiserPaging";
import { encodeTimeCursor } from "@/lib/keysetCursor";

/*
 * Paging on the organiser Judging tab (docs/HACKATHON.md): bounded keyset
 * pages for Submissions with server-side filter and search, numbered Results
 * pages whose ranks (and ties) come from the whole ranking, award candidates
 * (SUBMITTED only), aggregate per-judge progress, and event/organisation
 * scoping throughout. Rows are seeded directly so the pages are realistic.
 */

const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `jpaging-${suffix}`;
const otherOrgSlug = `jpaging-other-${suffix}`;
const HOUR = 3_600_000;
const ENTRANTS = 120;

let organisationId = "";
let otherOrganisationId = "";
let organiserId = "";
let idleAdminId = "";
let judgeId = "";
let event: Event;
let foreignEvent: Event;
let ctx: JudgingOrganiserContext;
let criterionId = "";
let teamSubmissionId = "";

function statusFor(index: number): SubmissionStatus {
  if (index % 2 === 0) return SubmissionStatus.SUBMITTED;
  if (index % 4 === 1) return SubmissionStatus.DRAFT;
  return index % 8 === 3 ? SubmissionStatus.WITHDRAWN : SubmissionStatus.DISQUALIFIED;
}

async function createEvent(organisation: string): Promise<Event> {
  return prisma.event.create({
    data: {
      organisationId: organisation,
      title: `Paging ${suffix}`,
      slug: `paging-${suffix}-${randomUUID().slice(0, 8)}`,
      startDateTime: new Date(Date.now() + 24 * HOUR),
      endDateTime: new Date(Date.now() + 48 * HOUR),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      registrationMode: RegistrationMode.TEAM,
      teamMaxSize: 4,
      soloPolicy: SoloPolicy.SOLO_ALLOWED,
      submissionsEnabled: true,
      judgesSeeAll: true,
      page: { create: { isPublished: true } },
    },
  });
}

/** Solo entrants with one submission each; several share a creation time so the id breaks ties. */
async function seedSolos(target: Event, count: number, titlePrefix: string) {
  const base = Date.now() - 10 * HOUR;
  const rsvps = Array.from({ length: count }, (_, index) => ({
    id: `r${suffix.slice(0, 12)}${target.id.slice(-6)}${String(index).padStart(4, "0")}`,
    eventId: target.id,
    guestName: `Entrant ${index}`,
    guestEmail: `entrant-${index}-${suffix}@example.test`,
    attendeeKey: `entrant-${index}-${suffix}@example.test`,
    status: RsvpStatus.CONFIRMED,
  }));
  await prisma.rSVP.createMany({ data: rsvps });
  await prisma.submission.createMany({
    data: rsvps.map((rsvp, index) => {
      const status = statusFor(index);
      const createdAt = new Date(base + Math.floor(index / 3) * 60_000);
      return {
        eventId: target.id,
        rsvpId: rsvp.id,
        title: index === 7 ? `${titlePrefix} 50%_off` : `${titlePrefix} ${String(index).padStart(3, "0")}`,
        status,
        createdAt,
        submittedAt: status === SubmissionStatus.SUBMITTED || status === SubmissionStatus.DISQUALIFIED ? new Date(createdAt.getTime() + 1000) : null,
      };
    }),
  });
}

async function allPages(input: { status?: string; query?: string }) {
  const pages: OrganiserSubmissionsPage[] = [];
  let cursor: string | null = null;
  do {
    const page: OrganiserSubmissionsPage = await listSubmissionsForOrganiser(ctx, { ...input, cursor });
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor && pages.length < 20);
  return pages;
}

describe.sequential("organiser judging paging", () => {
  beforeAll(async () => {
    const [org, other] = await Promise.all([
      prisma.organisation.create({ data: { name: `Paging ${suffix}`, slug: orgSlug } }),
      prisma.organisation.create({ data: { name: `Paging other ${suffix}`, slug: otherOrgSlug } }),
    ]);
    organisationId = org.id;
    otherOrganisationId = other.id;
    const [owner, idle, judge] = await Promise.all([
      prisma.user.create({ data: { name: "Organiser", email: `organiser-${suffix}@example.test` } }),
      prisma.user.create({ data: { name: "Idle Admin", email: `idle-${suffix}@example.test` } }),
      prisma.user.create({ data: { name: "Judge Paging", email: `judge-${suffix}@example.test`, emailVerified: new Date() } }),
    ]);
    organiserId = owner.id;
    idleAdminId = idle.id;
    judgeId = judge.id;
    await prisma.membership.createMany({
      data: [
        { userId: organiserId, organisationId, role: MembershipRole.OWNER },
        { userId: idleAdminId, organisationId, role: MembershipRole.ADMIN },
      ],
    });

    event = await createEvent(organisationId);
    foreignEvent = await createEvent(otherOrganisationId);
    await prisma.eventCollaborator.create({ data: { eventId: event.id, userId: judgeId, permissions: [EventPermission.JUDGE] } });
    await seedSolos(event, ENTRANTS, "Project");
    await seedSolos(foreignEvent, 5, "Project");

    // One team entry, found by its team name.
    const team = await prisma.team.create({
      data: {
        eventId: event.id,
        name: `Zebra Squad ${suffix.slice(0, 6)}`,
        nameKey: `zebra squad ${suffix.slice(0, 6)}`,
        status: RsvpStatus.CONFIRMED,
        joinToken: randomBytes(16).toString("hex"),
        manageTokenHash: randomBytes(32).toString("hex"),
      },
    });
    const teamSubmission = await prisma.submission.create({ data: { eventId: event.id, teamId: team.id, title: "Plain title", status: SubmissionStatus.DRAFT } });
    teamSubmissionId = teamSubmission.id;

    const resolved = await resolveJudgingOrganiser(organiserId, orgSlug, event.id);
    if (!resolved) throw new Error("organiser context missing");
    ctx = resolved;

    // Rubric: one criterion out of 10. Scores step down every 6 projects, so
    // ranks 49–54 tie across the boundary between results pages 1 and 2. The
    // last 5 SUBMITTED projects have no review (no score, no rank).
    const criterion = await prisma.judgingCriterion.create({ data: { eventId: event.id, name: "Overall", weight: 1, maxScore: 10, position: 0 } });
    criterionId = criterion.id;
    await prisma.event.update({ where: { id: event.id }, data: { judgingStatus: JudgingStatus.OPEN } });
    const submitted = await prisma.submission.findMany({ where: { eventId: event.id, status: SubmissionStatus.SUBMITTED }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], select: { id: true } });
    const scored = submitted.slice(0, submitted.length - 5);
    await prisma.judgeScore.createMany({ data: scored.map((row, index) => ({ submissionId: row.id, judgeUserId: judgeId, criterionId, score: Math.max(0, 10 - Math.floor(index / 6)) })) });
    await prisma.judgeReview.createMany({ data: scored.map((row) => ({ submissionId: row.id, judgeUserId: judgeId, comment: "", submittedAt: new Date() })) });
  });

  afterAll(async () => {
    await prisma.organisation.deleteMany({ where: { id: { in: [organisationId, otherOrganisationId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [organiserId, idleAdminId, judgeId].filter(Boolean) } } });
    await prisma.$disconnect();
  });

  it("pages every submission once, oldest first, with counts from aggregates", async () => {
    const pages = await allPages({});
    const ids = pages.flatMap((page) => page.submissions.map((row) => row.id));
    expect(pages.map((page) => page.submissions.length)).toEqual([ORGANISER_SUBMISSIONS_PAGE_SIZE, ORGANISER_SUBMISSIONS_PAGE_SIZE, ENTRANTS + 1 - 2 * ORGANISER_SUBMISSIONS_PAGE_SIZE]);
    expect(pages.at(-1)?.nextCursor).toBeNull();
    expect(new Set(ids).size).toBe(ids.length);
    const expected = await prisma.submission.findMany({ where: { eventId: event.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    expect(ids).toEqual(expected.map((row) => row.id));

    const setup = await loadJudgingSetup(ctx);
    expect(Object.values(setup!.counts).reduce((sum, count) => sum + count, 0)).toBe(ENTRANTS + 1);
    for (const status of Object.values(SubmissionStatus)) {
      const filtered = (await allPages({ status })).flatMap((page) => page.submissions);
      expect(filtered.every((row) => row.status === status)).toBe(true);
      expect(filtered).toHaveLength(setup!.counts[status]);
    }
  });

  it("searches titles and entrant names on the server, with wildcards taken literally", async () => {
    const byTeam = (await listSubmissionsForOrganiser(ctx, { query: "zebra squad" })).submissions;
    expect(byTeam.map((row) => row.id)).toEqual([teamSubmissionId]);
    const literal = (await listSubmissionsForOrganiser(ctx, { query: "50%_" })).submissions;
    expect(literal.map((row) => row.title)).toEqual(["Project 50%_off"]);
    expect((await listSubmissionsForOrganiser(ctx, { query: "%" })).submissions.map((row) => row.title)).toEqual(["Project 50%_off"]);
    // The registrant's full name is searched (organisers see it in Guests): "Entrant 11" and "Entrant 110"–"119".
    const byName = (await listSubmissionsForOrganiser(ctx, { query: "Entrant 11" })).submissions;
    expect(byName).toHaveLength(11);
    // Search and status combine.
    const draftsNamed = (await listSubmissionsForOrganiser(ctx, { query: "Project 00", status: "DRAFT" })).submissions;
    expect(draftsNamed.length).toBeGreaterThan(0);
    expect(draftsNamed.every((row) => row.status === "DRAFT" && row.title.startsWith("Project 00"))).toBe(true);
  });

  it("stays inside the organiser's event and organisation", async () => {
    // Another organisation's event, forged onto this context: nothing.
    const forged: JudgingOrganiserContext = { ...ctx, eventId: foreignEvent.id, eventSlug: foreignEvent.slug };
    expect(await listSubmissionsForOrganiser(forged)).toEqual({ submissions: [], nextCursor: null });
    expect(await loadJudgingResultsPage(forged)).toBeNull();
    expect(await searchAwardCandidates(forged)).toBeNull();
    expect(await loadJudgeProgress(forged)).toBeNull();
    // A cursor naming a foreign row only moves within this event.
    const foreign = await prisma.submission.findFirstOrThrow({ where: { eventId: foreignEvent.id }, orderBy: { createdAt: "asc" } });
    const page = await listSubmissionsForOrganiser(ctx, { cursor: encodeTimeCursor({ at: foreign.createdAt, id: foreign.id }) });
    expect(page.submissions.every((row) => !row.id.startsWith(foreign.id))).toBe(true);
    const foreignIds = new Set((await prisma.submission.findMany({ where: { eventId: foreignEvent.id }, select: { id: true } })).map((row) => row.id));
    expect(page.submissions.some((row) => foreignIds.has(row.id))).toBe(false);
    // Malformed input pages nothing rather than everything.
    expect(await listSubmissionsForOrganiser(ctx, { cursor: "not-a-cursor" })).toEqual({ submissions: [], nextCursor: null });
    expect(await listSubmissionsForOrganiser(ctx, { status: "ANYTHING" })).toEqual({ submissions: [], nextCursor: null });
    expect(await listSubmissionsForOrganiser(ctx, { query: "x".repeat(101) })).toEqual({ submissions: [], nextCursor: null });
    expect(await loadJudgingResultsPage(ctx, { page: 0 })).toBeNull();
    expect(await searchAwardCandidates(ctx, { offset: -1 })).toBeNull();
  });

  it("ranks over every project and only slices the results for display", async () => {
    const full = await loadJudgingResults(ctx);
    const first = await loadJudgingResultsPage(ctx);
    expect(first).toMatchObject({ page: 1, total: full!.rows.length, rankedTotal: full!.rows.length, start: 0 });
    expect(first!.totalPages).toBe(Math.ceil(full!.rows.length / JUDGING_RESULTS_PAGE_SIZE));
    const shown = [];
    for (let page = 1; page <= first!.totalPages; page += 1) shown.push(...(await loadJudgingResultsPage(ctx, { page }))!.rows);
    expect(shown).toEqual(full!.rows);
    // The tie straddling pages 1 and 2 keeps one shared rank (standard competition ranking).
    const second = await loadJudgingResultsPage(ctx, { page: 2 });
    expect(first!.rows.at(-1)!.score).toBe(second!.rows[0]!.score);
    expect(first!.rows.at(-1)!.rank).toBe(second!.rows[0]!.rank);
    expect(second!.rows[0]!.rank).toBe(49);
    // A page past the end shows the last page.
    expect((await loadJudgingResultsPage(ctx, { page: 999 }))!.page).toBe(first!.totalPages);
    // A search filters the ranked rows without renumbering them.
    const searched = await loadJudgingResultsPage(ctx, { query: "project 01" });
    expect(searched!.rows.length).toBeGreaterThan(0);
    expect(searched!.total).toBe(searched!.rows.length);
    const ranks = new Map(full!.rows.map((row) => [row.submissionId, row.rank]));
    for (const row of searched!.rows) {
      expect(row.title.toLowerCase()).toContain("project 01");
      expect(row.rank).toBe(ranks.get(row.submissionId));
    }
    // Disqualified projects stay listed after the ranked ones, unranked.
    expect(full!.rows.filter((row) => row.status === "DISQUALIFIED").every((row) => row.rank === null)).toBe(true);
  });

  it("offers award candidates from the ranking, SUBMITTED only, in short steps", async () => {
    const full = await loadJudgingResults(ctx);
    const expected = full!.rows.filter((row) => row.status === "SUBMITTED").map((row) => row.submissionId);
    const collected: string[] = [];
    let offset: number | null = 0;
    let steps = 0;
    while (offset != null && steps < 20) {
      const page = await searchAwardCandidates(ctx, { offset });
      expect(page!.rows.length).toBeLessThanOrEqual(AWARD_CANDIDATES_PAGE_SIZE);
      expect(page!.total).toBe(expected.length);
      collected.push(...page!.rows.map((row) => row.submissionId));
      offset = page!.nextOffset;
      steps += 1;
    }
    expect(collected).toEqual(expected);
    const searched = await searchAwardCandidates(ctx, { query: "50%_off" });
    // Index 7 is DISQUALIFIED, so it can never be offered.
    expect(searched!.rows).toEqual([]);
    const top = await searchAwardCandidates(ctx);
    expect(top!.rows[0]).toMatchObject({ rank: 1 });
  });

  it("counts judge progress with aggregates, applying assignments and conflicts", async () => {
    const submittedCount = await prisma.submission.count({ where: { eventId: event.id, status: SubmissionStatus.SUBMITTED } });
    let progress = await loadJudgeProgress(ctx);
    const judgeRow = () => progress!.find((row) => row.userId === judgeId);
    expect(judgeRow()).toMatchObject({ kind: "judge", visible: submittedCount, reviewsSubmitted: submittedCount - 5, assigned: 0 });
    // An organiser who hasn't judged shows "not judging yet".
    expect(progress!.find((row) => row.userId === idleAdminId)).toMatchObject({ kind: "admin", visible: null, reviewsSubmitted: 0 });

    // Assigned-only judging: the 10 latest SUBMITTED (5 reviewed) and 2 DRAFT projects.
    await prisma.event.update({ where: { id: event.id }, data: { judgesSeeAll: false } });
    const submitted = await prisma.submission.findMany({ where: { eventId: event.id, status: SubmissionStatus.SUBMITTED }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 10, select: { id: true, rsvpId: true } });
    const drafts = await prisma.submission.findMany({ where: { eventId: event.id, status: SubmissionStatus.DRAFT }, take: 2, select: { id: true } });
    await prisma.judgeAssignment.createMany({ data: [...submitted, ...drafts].map((row) => ({ eventId: event.id, judgeUserId: judgeId, submissionId: row.id })) });
    progress = await loadJudgeProgress(ctx);
    // Reviews count wherever they are (as in the ranking); visibility follows the assignments.
    expect(judgeRow()).toMatchObject({ visible: 10, reviewsSubmitted: submittedCount - 5, assigned: 12 });

    // The judge's own account turns out to own a reviewed, assigned entrant: hidden and not counted.
    const reviewedAssigned = submitted[6]!;
    await prisma.rSVP.update({ where: { id: reviewedAssigned.rsvpId! }, data: { userId: judgeId } });
    progress = await loadJudgeProgress(ctx);
    expect(judgeRow()).toMatchObject({ visible: 9, reviewsSubmitted: submittedCount - 6, assigned: 12 });

    // Losing the grant keeps the judge listed for the record, with nothing counted.
    await prisma.eventCollaborator.deleteMany({ where: { eventId: event.id, userId: judgeId } });
    progress = await loadJudgeProgress(ctx);
    expect(judgeRow()).toMatchObject({ visible: 0, reviewsSubmitted: 0, email: null });
  });
});
