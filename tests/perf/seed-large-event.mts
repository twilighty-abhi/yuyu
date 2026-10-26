/*
 * Large-event load seed (docs/PERFORMANCE.md). Fills a fresh, disposable
 * database with one big hackathon plus 20 smaller events across three
 * organisations, so query plans can be measured at realistic scale:
 *
 *   - "Load Hackathon": a TEAM event (2–4 per team, solo with matching),
 *     submissions enabled and judging OPEN: 5,000 teams of 1–4 people,
 *     ~15,000 registrations, 500 solo registrants (300 seekers), ~4,000
 *     submissions, 6 criteria, 25 JUDGE collaborators, ~20,000 reviews with
 *     their scores, ~11,000 assignments, ~3,000 invites, ~6,000 check-ins,
 *     two registration questions, a custom check-in list and three awards.
 *   - 20 smaller INDIVIDUAL and TEAM events in three organisations.
 *
 * Every address is fake (@load.yuyu.test) and no outbox rows are written.
 * Deterministic (seeded PRNG), createMany in batches.
 *
 *   PERF_DATABASE_URL=postgresql://…/yuyu_load node tests/perf/seed-large-event.mts
 *
 * Refuses to run unless the database is empty, and refuses a database
 * whose name does not contain "load" or "perf".
 */
import { createHash } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";

const url = process.env.PERF_DATABASE_URL?.trim();
if (!url) throw new Error("PERF_DATABASE_URL is required (a disposable database).");
const dbName = new URL(url).pathname.slice(1);
if (!/load|perf/.test(dbName)) throw new Error(`Refusing to seed "${dbName}": the database name must contain "load" or "perf".`);

const prisma = new PrismaClient({ datasources: { db: { url } } });

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

let state = 0x5eed1234;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
function sample<T>(items: readonly T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, count);
}
let idCounter = 0;
/** cuid-shaped ids (25 lowercase base36 characters starting with "c"). */
function id(): string {
  idCounter += 1;
  let body = "";
  for (let i = 0; i < 16; i++) body += Math.floor(rand() * 36).toString(36);
  return `c${idCounter.toString(36).padStart(8, "0")}${body}`;
}
const hex = (value: string) => createHash("sha256").update(value).digest("hex");

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(now + offsetMs);

const FIRST = ["Ada", "Grace", "Alan", "Linus", "Margaret", "Ken", "Barbara", "Dennis", "Frances", "Edsger", "Radia", "Tim", "Katherine", "Donald", "Hedy", "John", "Shafi", "Leslie", "Anita", "Guido", "Yukihiro", "Bjarne", "Sophie", "Niklaus", "Priya", "Arjun", "Mei", "Kofi", "Amara", "Diego"];
const LAST = ["Lovelace", "Hopper", "Turing", "Torvalds", "Hamilton", "Thompson", "Liskov", "Ritchie", "Allen", "Dijkstra", "Perlman", "Berners", "Johnson", "Knuth", "Lamarr", "McCarthy", "Goldwasser", "Lamport", "Borg", "Rossum", "Matsumoto", "Stroustrup", "Wilson", "Wirth", "Sharma", "Iyer", "Chen", "Mensah", "Okafor", "Garcia"];
const ADJ = ["Quantum", "Rapid", "Silent", "Crimson", "Bright", "Clever", "Brave", "Lucky", "Cosmic", "Nimble", "Electric", "Golden", "Hidden", "Iron", "Jolly"];
const NOUN = ["Owls", "Falcons", "Coders", "Builders", "Hackers", "Pandas", "Rockets", "Wizards", "Foxes", "Otters", "Ravens", "Tigers", "Comets", "Pixels", "Bytes"];
const WORDS = ["Smart", "Green", "Health", "Civic", "Open", "Data", "Climate", "Food", "Transit", "Learning", "Water", "Energy", "Safety", "Access", "Finance"];
const THINGS = ["Tracker", "Assistant", "Platform", "Network", "Dashboard", "Planner", "Mapper", "Exchange", "Monitor", "Guide", "Bot", "Toolkit", "Market", "Hub", "Lens"];

async function batched<T>(rows: T[], size: number, write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

// Accumulated rows, written in dependency order at the end.
const users: Prisma.UserCreateManyInput[] = [];
const organisations: Prisma.OrganisationCreateManyInput[] = [];
const memberships: Prisma.MembershipCreateManyInput[] = [];
const events: Prisma.EventCreateManyInput[] = [];
const pages: Prisma.EventPageCreateManyInput[] = [];
const forms: Prisma.EventRegistrationFormCreateManyInput[] = [];
const fields: Prisma.EventRegistrationFieldCreateManyInput[] = [];
const collaborators: Prisma.EventCollaboratorCreateManyInput[] = [];
const teams: Prisma.TeamCreateManyInput[] = [];
const rsvps: Prisma.RSVPCreateManyInput[] = [];
const answers: Prisma.RsvpAnswerCreateManyInput[] = [];
const seekers: Prisma.TeamSeekerProfileCreateManyInput[] = [];
const joinRequests: Prisma.TeamJoinRequestCreateManyInput[] = [];
const invites: Prisma.EventInviteCreateManyInput[] = [];
const checkInEvents: Prisma.CheckInEventCreateManyInput[] = [];
const checkInLists: Prisma.CheckInListCreateManyInput[] = [];
const checkInListRecords: Prisma.CheckInListRecordCreateManyInput[] = [];
const submissions: Prisma.SubmissionCreateManyInput[] = [];
const criteria: Prisma.JudgingCriterionCreateManyInput[] = [];
const assignments: Prisma.JudgeAssignmentCreateManyInput[] = [];
const reviews: Prisma.JudgeReviewCreateManyInput[] = [];
const scores: Prisma.JudgeScoreCreateManyInput[] = [];
const awards: Prisma.EventAwardCreateManyInput[] = [];
const awardWinners: Prisma.EventAwardWinnerCreateManyInput[] = [];

let userSeq = 0;
function newUser(prefix = "person"): string {
  userSeq += 1;
  const userId = id();
  users.push({ id: userId, name: `${pick(FIRST)} ${pick(LAST)}`, email: `${prefix}-${userSeq}@load.yuyu.test`, createdAt: at(-60 * DAY) });
  return userId;
}

let guestSeq = 0;
/** One registration: a signed-in user 60% of the time, otherwise a guest. */
function newRsvp(eventId: string, createdAt: Date, extra: Partial<Prisma.RSVPCreateManyInput> = {}, userId?: string): Prisma.RSVPCreateManyInput {
  const rsvpId = id();
  const asUser = userId ?? (rand() < 0.6 ? newUser() : null);
  guestSeq += 1;
  const guestEmail = `guest-${guestSeq}@load.yuyu.test`;
  const row: Prisma.RSVPCreateManyInput = {
    id: rsvpId,
    eventId,
    userId: asUser,
    guestEmail: asUser ? null : guestEmail,
    guestName: asUser ? null : `${pick(FIRST)} ${pick(LAST)}`,
    attendeeKey: asUser ? `user:${asUser}` : `guest:${guestEmail}`,
    status: "CONFIRMED",
    checkInToken: `t${id()}`,
    createdAt,
    ...extra,
  };
  rsvps.push(row);
  return row;
}

function statusFor(): "CONFIRMED" | "WAITLISTED" | "PENDING_APPROVAL" | "REJECTED" {
  const r = rand();
  return r < 0.85 ? "CONFIRMED" : r < 0.92 ? "WAITLISTED" : r < 0.97 ? "PENDING_APPROVAL" : "REJECTED";
}

type EventSpec = {
  organisationId: string;
  title: string;
  slug: string;
  team: boolean;
  teamCount: number;
  soloCount: number;
  seekers: number;
  individualCount: number;
  invites: number;
  checkInShare: number;
  submissionShare: number;
  criteria: number;
  judges: string[];
  reviewsPerProject: [number, number];
  assignmentsPerProject: number;
  awards: number;
  checkInList: boolean;
  judgeEntrants: string[];
};

function seedEvent(spec: EventSpec) {
  const eventId = id();
  const start = at(-2 * DAY);
  events.push({
    id: eventId,
    organisationId: spec.organisationId,
    title: spec.title,
    slug: spec.slug,
    description: `${spec.title}: a load-test event.`,
    startDateTime: start,
    endDateTime: at(1 * DAY),
    timezone: "Europe/London",
    location: "Load Hall",
    status: "PUBLISHED",
    privacyType: "PUBLIC",
    registrationMode: spec.team ? "TEAM" : "INDIVIDUAL",
    teamMinSize: spec.team ? 2 : null,
    teamMaxSize: spec.team ? 4 : null,
    soloPolicy: spec.team ? "SOLO_WITH_MATCHING" : "SOLO_ALLOWED",
    submissionsEnabled: spec.submissionShare > 0,
    submissionsOpenAt: spec.submissionShare > 0 ? at(-10 * DAY) : null,
    submissionsCloseAt: spec.submissionShare > 0 ? at(-1 * DAY) : null,
    judgingStatus: spec.submissionShare > 0 ? "OPEN" : "NOT_STARTED",
    judgesSeeAll: true,
    projectGalleryPublic: spec.submissionShare > 0,
    resultsPublishedAt: spec.awards > 0 ? at(-1 * HOUR) : null,
    resultsAnnouncedAt: spec.awards > 0 ? at(-1 * HOUR) : null,
    createdAt: at(-40 * DAY),
  });
  pages.push({ id: id(), eventId, isPublished: true });
  const formId = id();
  forms.push({ id: formId, eventId });
  const orgField = id();
  const shirtField = id();
  fields.push(
    { id: orgField, formId, key: "organisation", label: "Organisation", type: "TEXT", sortOrder: 0 },
    { id: shirtField, formId, key: "tshirt", label: "T-shirt size", type: "SELECT", sortOrder: 1, options: ["S", "M", "L", "XL"] },
  );
  for (const userId of spec.judges) collaborators.push({ id: id(), eventId, userId, permissions: ["JUDGE"] });

  const eventRsvps: Prisma.RSVPCreateManyInput[] = [];
  const teamRows: Array<{ id: string; status: string; members: Prisma.RSVPCreateManyInput[] }> = [];
  const regWindow = 30 * DAY;
  const regStart = -35 * DAY;
  const judgeEntrants = [...spec.judgeEntrants];

  if (spec.team) {
    for (let i = 0; i < spec.teamCount; i++) {
      const teamId = id();
      const status = statusFor();
      const createdAt = at(regStart + Math.floor((i / spec.teamCount) * regWindow) + int(0, 60_000));
      const name = `${pick(ADJ)} ${pick(NOUN)} ${i + 1}`;
      teams.push({
        id: teamId,
        eventId,
        name,
        nameKey: name.toLowerCase(),
        status,
        joinToken: `j${id()}`,
        manageTokenHash: hex(`manage-${teamId}`),
        lookingForMembers: rand() < 0.15,
        createdAt,
        updatedAt: createdAt,
      });
      const r = rand();
      const size = r < 0.1 ? 1 : r < 0.35 ? 2 : r < 0.65 ? 3 : 4;
      const members: Prisma.RSVPCreateManyInput[] = [];
      for (let m = 0; m < size; m++) {
        const judgeUser = m === 1 && judgeEntrants.length && i % 997 === 3 ? judgeEntrants.shift() : undefined;
        members.push(newRsvp(eventId, new Date(createdAt.getTime() + m * 7 * 60_000), { teamId, status }, judgeUser));
      }
      eventRsvps.push(...members);
      teamRows.push({ id: teamId, status, members });
    }
  }
  const soloRows: Prisma.RSVPCreateManyInput[] = [];
  const soloTotal = spec.team ? spec.soloCount : spec.individualCount;
  for (let i = 0; i < soloTotal; i++) {
    const createdAt = at(regStart + Math.floor((i / soloTotal) * regWindow) + int(0, 600_000));
    const row = newRsvp(eventId, createdAt, { status: spec.team ? (rand() < 0.9 ? "CONFIRMED" : "WAITLISTED") : statusFor() });
    soloRows.push(row);
    eventRsvps.push(row);
  }
  if (spec.team) {
    for (const row of soloRows.slice(0, spec.seekers)) {
      seekers.push({ id: id(), rsvpId: row.id!, headline: `${pick(WORDS)} developer`, skills: sample(["react", "python", "design", "ml", "rust", "go", "sql", "devops"], 3) });
    }
    // Join requests and invites between seekers and teams that are looking.
    const looking = teamRows.filter((team) => team.status === "CONFIRMED").slice(0, 400);
    soloRows.slice(0, Math.min(spec.seekers, 200)).forEach((row, index) => {
      const team = looking[index % Math.max(1, looking.length)];
      if (!team) return;
      joinRequests.push({ id: id(), teamId: team.id, rsvpId: row.id!, direction: index % 2 ? "INVITE" : "REQUEST", status: index % 5 === 0 ? "DECLINED" : "PENDING", createdAt: at(-5 * DAY + index * 60_000) });
    });
  }

  for (const row of eventRsvps) {
    answers.push({ id: id(), rsvpId: row.id!, fieldId: orgField, valueText: `${pick(WORDS)} ${pick(THINGS)} Ltd` });
    answers.push({ id: id(), rsvpId: row.id!, fieldId: shirtField, valueText: pick(["S", "M", "L", "XL"]) });
  }

  // Check-ins: confirmed registrations, newest last.
  const confirmed = eventRsvps.filter((row) => row.status === "CONFIRMED");
  const checkedIn = sample(confirmed, Math.floor(confirmed.length * spec.checkInShare));
  checkedIn.forEach((row, index) => {
    const when = at(-36 * HOUR + Math.floor((index / Math.max(1, checkedIn.length)) * 30 * HOUR));
    row.checkedInAt = when;
    if (index % 50 === 0) {
      checkInEvents.push({ id: id(), rsvpId: row.id!, action: "CHECKED_IN", source: "online", occurredAt: new Date(when.getTime() - 120_000) });
      checkInEvents.push({ id: id(), rsvpId: row.id!, action: "CHECK_IN_UNDONE", source: "online", occurredAt: new Date(when.getTime() - 60_000) });
    }
    checkInEvents.push({ id: id(), rsvpId: row.id!, action: "CHECKED_IN", source: index % 3 ? "online" : "venue-station", occurredAt: when });
  });
  if (spec.checkInList) {
    const listId = id();
    checkInLists.push({ id: listId, eventId, name: "Swag", sortOrder: 0 });
    for (const row of checkedIn.slice(0, Math.floor(checkedIn.length / 4))) {
      checkInListRecords.push({ id: id(), listId, rsvpId: row.id!, source: "online", checkedInAt: at(-12 * HOUR) });
    }
  }

  for (let i = 0; i < spec.invites; i++) {
    invites.push({ id: id(), eventId, email: `invitee-${spec.slug}-${i}@load.yuyu.test`, createdAt: at(-30 * DAY + i * 60_000) });
  }

  if (spec.submissionShare <= 0) return { eventId, teamCount: teamRows.length, rsvps: eventRsvps.length };

  // Criteria.
  const criterionRows = Array.from({ length: spec.criteria }, (_, index) => ({
    id: id(),
    eventId,
    name: `${pick(WORDS)} criterion ${index + 1}`,
    weight: 1 + (index % 3),
    maxScore: index % 2 ? 5 : 10,
    position: index,
  }));
  criteria.push(...criterionRows);

  // Entrants: confirmed teams first, then a few solos.
  const confirmedTeams = teamRows.filter((team) => team.status === "CONFIRMED");
  const entrantTeams = sample(confirmedTeams, Math.floor(confirmedTeams.length * spec.submissionShare));
  const entrantSolos = sample(spec.team ? soloRows.filter((row) => row.status === "CONFIRMED") : confirmed, spec.team ? Math.floor(soloRows.length * 0.4) : Math.floor(confirmed.length * spec.submissionShare));
  const submitted: Array<{ id: string; teamId: string | null; rsvpId: string | null; memberUserIds: string[] }> = [];
  const disqualified: string[] = [];
  const entrants = [
    ...entrantTeams.map((team) => ({ teamId: team.id, rsvpId: null as string | null, memberUserIds: team.members.map((m) => m.userId).filter(Boolean) as string[] })),
    ...entrantSolos.map((row) => ({ teamId: null as string | null, rsvpId: row.id!, memberUserIds: row.userId ? [row.userId] : [] })),
  ];
  entrants.forEach((entrant, index) => {
    const r = rand();
    const status = r < 0.89 ? "SUBMITTED" : r < 0.95 ? "DRAFT" : r < 0.965 ? "WITHDRAWN" : "DISQUALIFIED";
    const submissionId = id();
    const createdAt = at(-9 * DAY + Math.floor((index / entrants.length) * 7 * DAY));
    submissions.push({
      id: submissionId,
      eventId,
      teamId: entrant.teamId,
      rsvpId: entrant.rsvpId,
      title: `${pick(WORDS)} ${pick(THINGS)} ${index + 1}`,
      summary: `A ${pick(WORDS).toLowerCase()} ${pick(THINGS).toLowerCase()} that helps people. `.repeat(6),
      repoUrl: `https://code.example.test/${spec.slug}/${index}`,
      demoUrl: index % 3 ? `https://demo.example.test/${spec.slug}/${index}` : null,
      status,
      submittedAt: status === "SUBMITTED" || status === "DISQUALIFIED" || status === "WITHDRAWN" ? new Date(createdAt.getTime() + int(1, 48) * HOUR) : null,
      disqualifiedReason: status === "DISQUALIFIED" ? "Load-test disqualification." : null,
      createdAt,
      updatedAt: createdAt,
    });
    if (status === "SUBMITTED") submitted.push({ id: submissionId, ...entrant });
    if (status === "DISQUALIFIED") disqualified.push(submissionId);
  });

  // Each judge has a bias so the adjusted score differs from the raw one.
  const bias = new Map(spec.judges.map((judge) => [judge, rand() * 0.5 - 0.25]));
  const reviewOne = (submissionId: string, judgeUserId: string, conflict: boolean) => {
    if (conflict) return;
    const submittedReview = rand() < 0.92;
    const reviewAt = at(-int(1, 72) * HOUR);
    reviews.push({ id: id(), submissionId, judgeUserId, comment: rand() < 0.3 ? "Solid work." : "", submittedAt: submittedReview ? reviewAt : null, createdAt: reviewAt, updatedAt: reviewAt });
    const quality = rand();
    const scored = submittedReview ? criterionRows : criterionRows.slice(0, int(0, criterionRows.length));
    for (const criterion of scored) {
      const value = Math.round(Math.min(1, Math.max(0, quality + (bias.get(judgeUserId) ?? 0) + (rand() - 0.5) * 0.3)) * criterion.maxScore);
      scores.push({ id: id(), submissionId, judgeUserId, criterionId: criterion.id, score: value, createdAt: reviewAt, updatedAt: reviewAt });
    }
  };
  for (const project of submitted) {
    const judges = sample(spec.judges, int(spec.reviewsPerProject[0], spec.reviewsPerProject[1]));
    for (const judgeUserId of judges) reviewOne(project.id, judgeUserId, project.memberUserIds.includes(judgeUserId));
    for (const judgeUserId of sample(spec.judges, spec.assignmentsPerProject)) {
      if (project.memberUserIds.includes(judgeUserId)) continue;
      assignments.push({ id: id(), eventId, judgeUserId, submissionId: project.id });
    }
  }
  for (const submissionId of disqualified) for (const judgeUserId of sample(spec.judges, 2)) reviewOne(submissionId, judgeUserId, false);

  for (let a = 0; a < spec.awards; a++) {
    const awardId = id();
    awards.push({ id: awardId, eventId, name: ["Overall winner", "Best design", "Community choice"][a] ?? `Award ${a + 1}`, position: a });
    sample(submitted, 3).forEach((project, place) => awardWinners.push({ id: id(), awardId, submissionId: project.id, place: place + 1 }));
  }
  return { eventId, teamCount: teamRows.length, rsvps: eventRsvps.length };
}

// ---------------------------------------------------------------------------
// Organisations and people
// ---------------------------------------------------------------------------

async function main() {
  const existing = await prisma.organisation.count();
  if (existing > 0) throw new Error("Refusing to seed: the database already has organisations. Use a fresh database.");

  const orgIds = ["a", "b", "c"].map((key) => {
    const orgId = id();
    organisations.push({ id: orgId, name: `Load Org ${key.toUpperCase()}`, slug: `load-${key}`, createdAt: at(-90 * DAY) });
    return orgId;
  });
  const owners = orgIds.map((organisationId, index) => {
    const owner = newUser(`owner-${index}`);
    const admin = newUser(`admin-${index}`);
    memberships.push({ id: id(), userId: owner, organisationId, role: "OWNER" }, { id: id(), userId: admin, organisationId, role: "ADMIN" });
    return owner;
  });
  const judges = Array.from({ length: 25 }, (_, index) => newUser(`judge-${index}`));

  const main = seedEvent({
    organisationId: orgIds[0]!,
    title: "Load Hackathon",
    slug: "load-hackathon",
    team: true,
    teamCount: 5000,
    soloCount: 500,
    seekers: 300,
    individualCount: 0,
    invites: 3000,
    checkInShare: 0.47,
    submissionShare: 0.9,
    criteria: 6,
    judges,
    reviewsPerProject: [5, 6],
    assignmentsPerProject: 3,
    awards: 3,
    checkInList: true,
    // Two judges also registered on a team: exercises the conflict-of-interest paths.
    judgeEntrants: [judges[3]!, judges[7]!],
  });

  const smallJudges = Array.from({ length: 6 }, (_, index) => newUser(`small-judge-${index}`));
  const small: Array<{ eventId: string }> = [];
  for (let i = 0; i < 20; i++) {
    const team = i % 2 === 0;
    small.push(
      seedEvent({
        organisationId: orgIds[i % 3]!,
        title: `Load Event ${i + 1}`,
        slug: `load-event-${i + 1}`,
        team,
        teamCount: team ? int(100, 300) : 0,
        soloCount: team ? int(20, 60) : 0,
        seekers: team ? 15 : 0,
        individualCount: team ? 0 : int(300, 900),
        invites: 100,
        checkInShare: 0.3,
        submissionShare: team ? 0.6 : 0,
        criteria: 4,
        judges: smallJudges,
        reviewsPerProject: [2, 3],
        assignmentsPerProject: 2,
        awards: team ? 1 : 0,
        checkInList: false,
        judgeEntrants: [],
      }),
    );
  }

  const started = Date.now();
  const step = async (label: string, rows: unknown[], write: (chunk: never[]) => Promise<unknown>, size = 5000) => {
    await batched(rows as never[], size, write);
    console.log(`${label.padEnd(22)} ${String(rows.length).padStart(7)}`);
  };
  await step("users", users, (chunk) => prisma.user.createMany({ data: chunk }));
  await step("organisations", organisations, (chunk) => prisma.organisation.createMany({ data: chunk }));
  await step("memberships", memberships, (chunk) => prisma.membership.createMany({ data: chunk }));
  await step("events", events, (chunk) => prisma.event.createMany({ data: chunk }));
  await step("event pages", pages, (chunk) => prisma.eventPage.createMany({ data: chunk }));
  await step("registration forms", forms, (chunk) => prisma.eventRegistrationForm.createMany({ data: chunk }));
  await step("registration fields", fields, (chunk) => prisma.eventRegistrationField.createMany({ data: chunk }));
  await step("collaborators", collaborators, (chunk) => prisma.eventCollaborator.createMany({ data: chunk }));
  await step("teams", teams, (chunk) => prisma.team.createMany({ data: chunk }));
  await step("registrations", rsvps, (chunk) => prisma.rSVP.createMany({ data: chunk }));
  // Each team's leader is its first member.
  await prisma.$executeRaw`
    UPDATE "Team" t SET "leaderRsvpId" = x."id"
    FROM (SELECT DISTINCT ON ("teamId") "id", "teamId" FROM "RSVP" WHERE "teamId" IS NOT NULL ORDER BY "teamId", "createdAt", "id") x
    WHERE x."teamId" = t."id"`;
  await step("answers", answers, (chunk) => prisma.rsvpAnswer.createMany({ data: chunk }));
  await step("seeker profiles", seekers, (chunk) => prisma.teamSeekerProfile.createMany({ data: chunk }));
  await step("join requests", joinRequests, (chunk) => prisma.teamJoinRequest.createMany({ data: chunk }));
  await step("invites", invites, (chunk) => prisma.eventInvite.createMany({ data: chunk }));
  await step("check-in history", checkInEvents, (chunk) => prisma.checkInEvent.createMany({ data: chunk }));
  await step("check-in lists", checkInLists, (chunk) => prisma.checkInList.createMany({ data: chunk }));
  await step("check-in list records", checkInListRecords, (chunk) => prisma.checkInListRecord.createMany({ data: chunk }));
  await step("submissions", submissions, (chunk) => prisma.submission.createMany({ data: chunk }));
  await step("criteria", criteria, (chunk) => prisma.judgingCriterion.createMany({ data: chunk }));
  await step("assignments", assignments, (chunk) => prisma.judgeAssignment.createMany({ data: chunk }));
  await step("reviews", reviews, (chunk) => prisma.judgeReview.createMany({ data: chunk }));
  await step("scores", scores, (chunk) => prisma.judgeScore.createMany({ data: chunk }), 10_000);
  await step("awards", awards, (chunk) => prisma.eventAward.createMany({ data: chunk }));
  await step("award winners", awardWinners, (chunk) => prisma.eventAwardWinner.createMany({ data: chunk }));
  await prisma.$executeRawUnsafe("ANALYZE");

  const mainEvent = await prisma.event.findUniqueOrThrow({ where: { id: main.eventId }, select: { id: true, organisationId: true } });
  const counts = await prisma.$queryRaw<Array<Record<string, bigint>>>`
    SELECT
      (SELECT count(*) FROM "Team" WHERE "eventId" = ${mainEvent.id}) AS "teams",
      (SELECT count(*) FROM "RSVP" WHERE "eventId" = ${mainEvent.id}) AS "registrations",
      (SELECT count(*) FROM "RSVP" WHERE "eventId" = ${mainEvent.id} AND "teamId" IS NULL) AS "solo",
      (SELECT count(*) FROM "Submission" WHERE "eventId" = ${mainEvent.id}) AS "submissions",
      (SELECT count(*) FROM "JudgeReview" jr JOIN "Submission" s ON s."id" = jr."submissionId" WHERE s."eventId" = ${mainEvent.id}) AS "reviews",
      (SELECT count(*) FROM "JudgeScore" js JOIN "Submission" s ON s."id" = js."submissionId" WHERE s."eventId" = ${mainEvent.id}) AS "scores",
      (SELECT count(*) FROM "EventInvite" WHERE "eventId" = ${mainEvent.id}) AS "invites",
      (SELECT count(*) FROM "RSVP" WHERE "eventId" = ${mainEvent.id} AND "checkedInAt" IS NOT NULL) AS "checkins"`;
  console.log("main event", Object.fromEntries(Object.entries(counts[0] ?? {}).map(([key, value]) => [key, Number(value)])));
  console.log(`seeded ${small.length + 1} events in ${((Date.now() - started) / 1000).toFixed(1)} s (owner of load-a: ${owners[0]})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
