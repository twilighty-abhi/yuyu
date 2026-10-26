/*
 * Large-event query measurement (docs/PERFORMANCE.md). Runs every loader
 * behind the team, judging and gallery screens against the seeded
 * PERF_DATABASE_URL, captures each SQL statement Prisma sends (query
 * events), and re-runs every captured SELECT under
 * EXPLAIN (ANALYZE, BUFFERS). Writes one JSON result per scenario to
 * PERF_OUT (default: perf-results.json in the working directory).
 *
 *   PERF_DATABASE_URL=… PERF_OUT=before.json npx vitest run --config tests/perf/vitest.perf.config.mts
 *
 * Read-only apart from toggling `resultsPublishedAt` around the
 * auto-assignment preview (restored afterwards).
 */
import { writeFileSync } from "node:fs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, it, vi } from "vitest";

type Captured = { query: string; params: string; duration: number };
const captured: Captured[] = [];
let capturing = false;

vi.mock("@/lib/db", () => {
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", (event: Prisma.QueryEvent) => {
    if (capturing) captured.push({ query: event.query, params: event.params, duration: event.duration });
  });
  return { prisma: client };
});
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { prisma } from "@/lib/db";
import { listAttendeesPage } from "@/lib/eventDashboard/attendees";
import { loadRsvpStatusCounts } from "@/lib/eventDashboard/data";
import { listEventInvitesPage } from "@/lib/eventDashboard/invites";
import { countEventTeamsForOrganiser, listEventTeamsForOrganiser, listTeamMoveTargetsForOrganiser, type OrganiserEventContext } from "@/lib/core/teams";
import { listRecentCheckIns } from "@/lib/checkInRecent";
import { downloadOfflineCheckInRosterForUser, lookupAttendeesForCheckInForUser } from "@/lib/core/checkin";
import {
  listSubmissionsForJudge,
  listSubmissionsForOrganiser,
  loadJudgeProgress,
  loadJudgingResults,
  loadJudgingResultsPage,
  loadJudgingSetup,
  loadProjectGallery,
  loadPublicResults,
  nextSubmissionForJudge,
  planJudgingResultsExport,
  planJudgingSubmissionsExport,
  searchAwardCandidates,
} from "@/lib/core/judging";
import { countUnsubmittedEntrants, listUnsubmittedEntrants } from "@/lib/core/judgingEntrants";
import { loadJudgingProgress, loadJudgingProgressPage, previewAutoAssignment } from "@/lib/core/judgingOps";
import type { JudgeContext, JudgingOrganiserContext } from "@/lib/judgingAccess";
import { encodeTimeCursor } from "@/lib/keysetCursor";

type Explained = { sql: string; rows: number; executionMs: number; planningMs: number; sharedHit: number; sharedRead: number; seqScans: string[] };
type ScenarioResult = { name: string; group: string; wallMs: number; queries: number; slowest: Explained | null; totalExecMs: number; explained: Explained[] };

const results: ScenarioResult[] = [];
const RUNS = Number(process.env.PERF_RUNS ?? 5);

let eventId = "";
let organisationId = "";
let orgSlug = "";
let eventSlug = "";
let ownerId = "";
let judgeId = "";
let organiser: JudgingOrganiserContext;
let teamCtx: OrganiserEventContext;
let judgeCtx: JudgeContext;
const origin = "http://127.0.0.1:4550";

function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (Array.isArray(value)) return `ARRAY[${value.map(literal).join(", ")}]`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The captured statement with its parameters inlined as literals (this is our own seeded data). */
function inline(entry: Captured): string {
  let params: unknown[] = [];
  try {
    params = JSON.parse(entry.params) as unknown[];
  } catch {
    params = [];
  }
  return entry.query.replace(/\$(\d+)/g, (match, index: string) => {
    const value = params[Number(index) - 1];
    return value === undefined ? match : literal(value);
  });
}

type PlanNode = { "Node Type": string; "Relation Name"?: string; "Actual Rows": number; "Actual Loops": number; Plans?: PlanNode[]; "Shared Hit Blocks"?: number; "Shared Read Blocks"?: number };

function seqScans(node: PlanNode, out: string[] = []): string[] {
  if (node["Node Type"] === "Seq Scan" && node["Relation Name"]) out.push(`${node["Relation Name"]}(${node["Actual Rows"] * node["Actual Loops"]})`);
  for (const child of node.Plans ?? []) seqScans(child, out);
  return out;
}

async function explain(entry: Captured): Promise<Explained | null> {
  const sql = inline(entry);
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return null;
  const rows = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": Array<{ Plan: PlanNode; "Execution Time": number; "Planning Time": number }> }>>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const plan = rows[0]!["QUERY PLAN"][0]!;
  return {
    sql: sql.replace(/\s+/g, " ").slice(0, 400),
    rows: plan.Plan["Actual Rows"] * plan.Plan["Actual Loops"],
    executionMs: plan["Execution Time"],
    planningMs: plan["Planning Time"],
    sharedHit: plan.Plan["Shared Hit Blocks"] ?? 0,
    sharedRead: plan.Plan["Shared Read Blocks"] ?? 0,
    seqScans: seqScans(plan.Plan),
  };
}

async function measure(group: string, name: string, run: () => Promise<unknown>) {
  await run(); // warm the plan cache and connection pool
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    captured.length = 0;
    capturing = i === RUNS - 1;
    const started = performance.now();
    await run();
    times.push(performance.now() - started);
    capturing = false;
  }
  const statements = captured.splice(0);
  const explained: Explained[] = [];
  for (const entry of statements) {
    const result = await explain(entry).catch((error: unknown) => {
      console.warn(`EXPLAIN failed for ${name}: ${(error as Error).message.slice(0, 200)}`);
      return null;
    });
    if (result) explained.push(result);
  }
  times.sort((a, b) => a - b);
  const wallMs = times[Math.floor(times.length / 2)]!;
  const slowest = explained.reduce<Explained | null>((worst, entry) => (!worst || entry.executionMs > worst.executionMs ? entry : worst), null);
  const totalExecMs = explained.reduce((sum, entry) => sum + entry.executionMs, 0);
  results.push({ name, group, wallMs, queries: statements.length, slowest, totalExecMs, explained });
  console.log(
    `${group.padEnd(10)} ${name.padEnd(48)} wall ${wallMs.toFixed(1).padStart(8)} ms  sql ${String(statements.length).padStart(3)}  slowest ${slowest ? slowest.executionMs.toFixed(1).padStart(7) : "    n/a"} ms rows ${slowest?.rows ?? 0}${slowest?.seqScans.length ? `  seq: ${slowest.seqScans.join(",")}` : ""}`,
  );
}

beforeAll(async () => {
  const event = await prisma.event.findFirstOrThrow({ where: { slug: "load-hackathon" }, select: { id: true, slug: true, organisationId: true, organisation: { select: { slug: true } } } });
  eventId = event.id;
  eventSlug = event.slug;
  organisationId = event.organisationId;
  orgSlug = event.organisation.slug;
  const owner = await prisma.membership.findFirstOrThrow({ where: { organisationId, role: "OWNER" }, select: { userId: true } });
  ownerId = owner.userId;
  const judge = await prisma.eventCollaborator.findFirstOrThrow({ where: { eventId, permissions: { has: "JUDGE" } }, orderBy: { createdAt: "asc" }, select: { userId: true } });
  judgeId = judge.userId;
  organiser = { userId: ownerId, organisationId, orgSlug, eventId, eventSlug };
  teamCtx = { userId: ownerId, organisationId, orgSlug, eventId, eventSlug };
  judgeCtx = { userId: judgeId, organisationId, orgSlug, eventId, eventSlug, isAdmin: false };
});

afterAll(() => {
  const out = process.env.PERF_OUT ?? "perf-results.json";
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`wrote ${results.length} scenarios to ${out}`);
});

async function drain(plan: { batches: () => AsyncGenerator<string[][]> } | null): Promise<number> {
  let rows = 0;
  if (!plan) return rows;
  for await (const batch of plan.batches()) rows += batch.length;
  return rows;
}

describe("large event", () => {
  it("people", async () => {
    const scope = { kind: "event" as const, eventId, organisationId };
    const options = { origin, teamMode: true };
    const deep = await prisma.rSVP.findMany({ where: { eventId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: 14_000, take: 1, select: { id: true, createdAt: true } });
    const deepCursor = encodeTimeCursor({ at: deep[0]!.createdAt, id: deep[0]!.id });
    await measure("people", "first page + chip counts", () => listAttendeesPage(scope, {}, options));
    await measure("people", "deep cursor page (row 14,000)", () => listAttendeesPage(scope, { cursor: deepCursor }, options));
    await measure("people", "search name 'lovelace'", () => listAttendeesPage(scope, { query: "lovelace" }, options));
    await measure("people", "search email 'guest-1234'", () => listAttendeesPage(scope, { query: "guest-1234" }, options));
    await measure("people", "search team name 'falcons 4'", () => listAttendeesPage(scope, { query: "falcons 4" }, options));
    for (const status of ["going", "waitlist", "approve", "declined", "checkedIn", "notCheckedIn"]) {
      await measure("people", `filter status=${status}`, () => listAttendeesPage(scope, { status }, options));
    }
    await measure("people", "filter kind=guests", () => listAttendeesPage(scope, { kind: "guests" }, options));
    await measure("people", "filter kind=users", () => listAttendeesPage(scope, { kind: "users" }, options));
    await measure("people", "filter team=solo", () => listAttendeesPage(scope, { team: "solo" }, options));
    await measure("people", "filter team=team", () => listAttendeesPage(scope, { team: "team" }, options));
    await measure("people", "status counts (header)", () => loadRsvpStatusCounts(eventId));
  });

  it("teams", async () => {
    await measure("teams", "first page", () => listEventTeamsForOrganiser(teamCtx));
    await measure("teams", "chip counts", () => countEventTeamsForOrganiser(teamCtx));
    await measure("teams", "search 'falcons'", () => listEventTeamsForOrganiser(teamCtx, { query: "falcons" }));
    await measure("teams", "search member 'guest-777'", () => listEventTeamsForOrganiser(teamCtx, { query: "guest-777" }));
    for (const filter of ["going", "waitlist", "approve", "declined", "incomplete", "looking"]) {
      await measure("teams", `filter ${filter}`, () => listEventTeamsForOrganiser(teamCtx, { filter }));
    }
    const last = await prisma.team.findFirstOrThrow({ where: { eventId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: 60, select: { id: true, createdAt: true } });
    await measure("teams", "deep cursor page", () => listEventTeamsForOrganiser(teamCtx, { cursor: encodeTimeCursor({ at: last.createdAt, id: last.id }) }));
    await measure("teams", "move targets first page", () => listTeamMoveTargetsForOrganiser(teamCtx, {}));
    await measure("teams", "move targets search 'owls'", () => listTeamMoveTargetsForOrganiser(teamCtx, { query: "owls" }));
  });

  it("invites and check-in", async () => {
    const scope = { eventId, organisationId };
    await measure("invites", "first page", () => listEventInvitesPage(scope, {}));
    await measure("invites", "page 50", () => listEventInvitesPage(scope, { page: 50 }));
    await measure("invites", "search 'invitee-load-hackathon-12'", () => listEventInvitesPage(scope, { query: "invitee-load-hackathon-12" }));
    const recent = await listRecentCheckIns(eventId);
    await measure("checkin", "recent first page", () => listRecentCheckIns(eventId));
    await measure("checkin", "recent next page", () => listRecentCheckIns(eventId, recent.nextCursor));
    await measure("checkin", "attendee lookup 'hopper'", () => lookupAttendeesForCheckInForUser(ownerId, { organisationSlug: orgSlug, eventId, query: "hopper" }));
    await measure("checkin", "offline roster (all)", () => downloadOfflineCheckInRosterForUser(ownerId, { organisationSlug: orgSlug, eventId }));
  });

  it("judging organiser", async () => {
    await measure("judging", "setup + status counts", () => loadJudgingSetup(organiser));
    await measure("judging", "submissions first page", () => listSubmissionsForOrganiser(organiser));
    await measure("judging", "submissions search 'climate'", () => listSubmissionsForOrganiser(organiser, { query: "climate" }));
    await measure("judging", "submissions status=DISQUALIFIED", () => listSubmissionsForOrganiser(organiser, { status: "DISQUALIFIED" }));
    await measure("judging", "results page 1 (ranking)", () => loadJudgingResultsPage(organiser));
    await measure("judging", "results page 40", () => loadJudgingResultsPage(organiser, { page: 40 }));
    await measure("judging", "results search 'health'", () => loadJudgingResultsPage(organiser, { query: "health" }));
    await measure("judging", "award candidates search", () => searchAwardCandidates(organiser, { query: "data" }));
    await measure("judging", "judges tab progress", () => loadJudgeProgress(organiser));
    await measure("judging", "progress summary (all lists)", () => loadJudgingProgress(organiser));
    await measure("judging", "progress below-target page 3", () => loadJudgingProgressPage(organiser, { section: "below-target", page: 3 }));
    await measure("judging", "progress per judge", () => loadJudgingProgressPage(organiser, { section: "judges", page: 1 }));
    await measure("judging", "progress outliers", () => loadJudgingProgressPage(organiser, { section: "outliers", page: 1 }));
    const judges = await prisma.eventCollaborator.findMany({ where: { eventId, permissions: { has: "JUDGE" } }, select: { userId: true } });
    const published = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { resultsPublishedAt: true } });
    await prisma.event.update({ where: { id: eventId }, data: { resultsPublishedAt: null } });
    try {
      await measure("judging", "auto-assign preview (25 judges, keep)", () => previewAutoAssignment(organiser, { perProject: 3, mode: "keep", judgeUserIds: judges.map((row) => row.userId) }));
      await measure("judging", "auto-assign preview (replace)", () => previewAutoAssignment(organiser, { perProject: 5, mode: "replace", judgeUserIds: judges.map((row) => row.userId) }));
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { resultsPublishedAt: published.resultsPublishedAt } });
    }
  });

  it("saved-view presets", async () => {
    await measure("views", "not submitted count", () => countUnsubmittedEntrants(organiser));
    await measure("views", "not submitted first page", () => listUnsubmittedEntrants(organiser));
    await measure("views", "not submitted search 'otters'", () => listUnsubmittedEntrants(organiser, { query: "otters" }));
    await measure("views", "results unscored", () => loadJudgingResultsPage(organiser, { scored: "unscored" }));
    await measure("views", "results under two judges", () => loadJudgingResultsPage(organiser, { scored: "underTwo" }));
  });

  it("judge workspace", async () => {
    await measure("judge", "workspace list (first page + counts)", () => listSubmissionsForJudge(judgeCtx));
    await measure("judge", "workspace filter todo", () => listSubmissionsForJudge(judgeCtx, { filter: "todo" }));
    await measure("judge", "workspace search 'energy'", () => listSubmissionsForJudge(judgeCtx, { query: "energy" }));
    await measure("judge", "score next", () => nextSubmissionForJudge(judgeCtx));
  });

  it("public gallery and results", async () => {
    const now = new Date();
    await measure("gallery", "newest page 1", () => loadProjectGallery(eventId, now));
    await measure("gallery", "newest page 60", () => loadProjectGallery(eventId, now, { page: 60 }));
    await measure("gallery", "search 'water'", () => loadProjectGallery(eventId, now, { query: "water" }));
    await measure("gallery", "search entrant 'ada'", () => loadProjectGallery(eventId, now, { query: "ada" }));
    await measure("gallery", "filter winners", () => loadProjectGallery(eventId, now, { filter: "winners" }));
    await measure("gallery", "sort a-z page 20", () => loadProjectGallery(eventId, now, { sort: "az", page: 20 }));
    await measure("gallery", "sort awards", () => loadProjectGallery(eventId, now, { sort: "awards" }));
    await measure("gallery", "results page", () => loadPublicResults(eventId));
    await measure("gallery", "results search 'smart'", () => loadPublicResults(eventId, { query: "smart" }));
  });

  it("exports (in process)", async () => {
    await measure("export", "judging results CSV (all reviews)", () => planJudgingResultsExport(organiser).then(drain));
    await measure("export", "judging submissions CSV", () => planJudgingSubmissionsExport(organiser).then(drain));
    await measure("export", "judging not-submitted CSV", () => planJudgingSubmissionsExport(organiser, { status: "notSubmitted" }).then(drain));
    await measure("export", "results ranking (loadJudgingResults)", () => loadJudgingResults(organiser));
  });
});
