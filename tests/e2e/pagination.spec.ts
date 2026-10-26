import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  EventPermission,
  EventPrivacyType,
  EventStatus,
  JudgingStatus,
  MembershipRole,
  PrismaClient,
  RegistrationMode,
  RsvpStatus,
  SoloPolicy,
  SubmissionStatus,
} from "@prisma/client";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Large-event paging (docs/TEAMS.md, docs/HACKATHON.md). The data is seeded
// straight into the database so each list runs past its first page: 60 teams
// (Teams view pages 50), 61 registrations (People pages 50), 60 ranked
// projects (Results pages 50) and 55 invites (Invites pages 50). Every check
// reads the page the server renders and the pages its actions return.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const password = "pagination-journey-password";
const ownerEmail = `paging-owner-${suffix}@example.test`;
const judgeEmail = `paging-judge-${suffix}@example.test`;
const orgSlug = `paging-${suffix}`;
const TEAMS = 60;
const INVITES = 55;
// The oldest registration: People lists newest first, so it sits past page one.
const needle = { name: `Quill Needle ${suffix}`, email: `paging-needle-${suffix}@example.test` };
const teamName = (index: number) => `Pager Team ${String(index).padStart(2, "0")} ${suffix}`;
const projectTitle = (index: number) => `Pager Project ${String(index).padStart(2, "0")} ${suffix}`;
const inviteEmail = (index: number) => `paging-invite-${String(index).padStart(2, "0")}-${suffix}@example.test`;

let ownerId = "";
let judgeId = "";
let organisationId = "";
let eventId = "";
let ipCounter = 10;

async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  // Its own TEST-NET-2 block (198.18.0.0/15 is benchmarking space): the other
  // specs count up through 198.51.100.x and 203.0.113.x, and a shared IP
  // shares the per-IP action and search limits.
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.18.7.${(ipCounter++ % 240) + 10}` });
  return context;
}

async function signIn(page: Page) {
  await page.request.get("/api/auth/csrf");
  await page.request.get("/api/auth/session");
  for (let attempt = 1; ; attempt++) {
    await page.goto("/login");
    const emailInput = page.getByRole("textbox", { name: /^Email/ });
    await expect.poll(() => emailInput.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
    await emailInput.fill(ownerEmail);
    await page.locator('input[type="password"]:visible').fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const failed = page.getByRole("alert").filter({ hasText: "Invalid email or password" });
    await expect.poll(async () => !new URL(page.url()).pathname.startsWith("/login") || (await failed.count()) > 0, { timeout: 60_000 }).toBe(true);
    if (!new URL(page.url()).pathname.startsWith("/login")) return;
    if (attempt === 3) throw new Error("Owner sign-in failed three times");
  }
}

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
let ownerSession: StorageState | undefined;

/** Signs in once and reuses the session: repeated sign-ins would trip the per-minute auth limit. */
async function ownerContext(browser: Browser) {
  if (!ownerSession) {
    const signInContext = await newContext(browser);
    await signIn(await signInContext.newPage());
    ownerSession = await signInContext.storageState();
    await signInContext.close();
  }
  const context = await newContext(browser, { storageState: ownerSession });
  return { context, page: await context.newPage() };
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function waitForHydration(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).filter({ visible: true }).first().evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
}

const dashboard = () => `/dashboard/${orgSlug}/event/${eventId}`;

/**
 * Visible text only. The dashboard's streamed HTML can leave a hidden copy of
 * the server-rendered panel behind once the client has rendered it.
 */
const shown = (page: Page, text: string) => page.getByText(text).filter({ visible: true });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  ownerId = (await prisma.user.create({ data: { email: ownerEmail, name: "Paging Owner", passwordHash, emailVerified: new Date() } })).id;
  judgeId = (await prisma.user.create({ data: { email: judgeEmail, name: "Paging Judge", passwordHash, emailVerified: new Date() } })).id;
  organisationId = (
    await prisma.organisation.create({
      data: { name: `Paging ${suffix}`, slug: orgSlug, memberships: { create: { userId: ownerId, role: MembershipRole.OWNER } } },
    })
  ).id;
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  eventId = (
    await prisma.event.create({
      data: {
        organisationId,
        title: `Paged Hack ${suffix}`,
        slug: `paged-${suffix}`,
        startDateTime: start,
        endDateTime: new Date(start.getTime() + 24 * 60 * 60 * 1000),
        timezone: "UTC",
        location: "Makerspace",
        status: EventStatus.PUBLISHED,
        privacyType: EventPrivacyType.PUBLIC,
        registrationMode: RegistrationMode.TEAM,
        teamMinSize: 1,
        teamMaxSize: 4,
        soloPolicy: SoloPolicy.SOLO_ALLOWED,
        submissionsEnabled: true,
        judgesSeeAll: true,
        judgingStatus: JudgingStatus.OPEN,
        page: { create: { isPublished: true, aboutHtml: "<p>A big one.</p>" } },
      },
    })
  ).id;
  await prisma.eventCollaborator.create({ data: { eventId, userId: judgeId, permissions: [EventPermission.JUDGE] } });

  const base = Date.now() - 10 * 60 * 60 * 1000;
  const minute = 60_000;
  // The needle registered first of all (a solo guest).
  await prisma.rSVP.create({
    data: { eventId, guestName: needle.name, guestEmail: needle.email, attendeeKey: `guest:${needle.email}`, status: RsvpStatus.CONFIRMED, createdAt: new Date(base - 60 * minute) },
  });
  // One leader per team, each team with a SUBMITTED project.
  for (let index = 0; index < TEAMS; index += 1) {
    const createdAt = new Date(base + index * minute);
    const email = `paging-leader-${String(index).padStart(2, "0")}-${suffix}@example.test`;
    const leader = await prisma.rSVP.create({
      data: { eventId, guestName: `Leader ${String(index).padStart(2, "0")} ${suffix}`, guestEmail: email, attendeeKey: `guest:${email}`, status: RsvpStatus.CONFIRMED, createdAt },
    });
    const team = await prisma.team.create({
      data: {
        eventId,
        name: teamName(index),
        nameKey: teamName(index).toLowerCase(),
        status: RsvpStatus.CONFIRMED,
        joinToken: randomBytes(16).toString("hex"),
        manageTokenHash: randomBytes(32).toString("hex"),
        leaderRsvpId: leader.id,
        createdAt,
      },
    });
    await prisma.rSVP.update({ where: { id: leader.id }, data: { teamId: team.id } });
    await prisma.submission.create({
      data: { eventId, teamId: team.id, title: projectTitle(index), status: SubmissionStatus.SUBMITTED, createdAt, submittedAt: new Date(createdAt.getTime() + 1000) },
    });
  }
  // One criterion; project N scores 10 - floor(N / 6), so ranks tie in sixes.
  const criterion = await prisma.judgingCriterion.create({ data: { eventId, name: "Overall", weight: 1, maxScore: 10, position: 0 } });
  const submissions = await prisma.submission.findMany({ where: { eventId }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], select: { id: true } });
  await prisma.judgeScore.createMany({
    data: submissions.map((row, index) => ({ submissionId: row.id, judgeUserId: judgeId, criterionId: criterion.id, score: Math.max(0, 10 - Math.floor(index / 6)) })),
  });
  await prisma.judgeReview.createMany({ data: submissions.map((row) => ({ submissionId: row.id, judgeUserId: judgeId, comment: "", submittedAt: new Date() })) });
  // Invites, newest first on screen: invite 00 is the oldest, on page 2.
  await prisma.eventInvite.createMany({
    data: Array.from({ length: INVITES }, (_, index) => ({ eventId, email: inviteEmail(index), createdAt: new Date(base + index * minute) })),
  });
});

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, judgeId].filter(Boolean) } } });
  await prisma.$disconnect();
});

test("People pages 50 at a time; Load more and the server search reach a guest past page one", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`${dashboard()}?tab=guests&sub=people`);
  const guests = page.getByRole("list", { name: "Guests" }).locator(":scope > li");
  await expect(guests).toHaveCount(50);
  await expect(shown(page, `Showing 50 of ${TEAMS + 1} guests`)).toBeVisible();
  // The chip counts cover every registration, not just the loaded page.
  await expect(page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^All/ })).toContainText(String(TEAMS + 1));
  await expect(guests.filter({ hasText: needle.name })).toHaveCount(0);

  await waitForHydration(page, "button");
  await page.getByRole("button", { name: "Load more guests" }).click();
  await expect(guests).toHaveCount(TEAMS + 1);
  await expect(shown(page, `Showing ${TEAMS + 1} of ${TEAMS + 1} guests`)).toBeVisible();
  await expect(guests.filter({ hasText: needle.name })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Load more guests" })).toHaveCount(0);

  // A fresh visit shows page one again; the search runs on the server.
  await page.goto(`${dashboard()}?tab=guests&sub=people`);
  await expect(guests).toHaveCount(50);
  const search = page.getByRole("searchbox", { name: "Search guests by name or email" });
  await waitForHydration(page, "#guest-search");
  await search.fill("Quill Needle");
  await expect(guests).toHaveCount(1);
  await expect(guests.first()).toContainText(needle.name);
  await expect(shown(page, "Showing 1 of 1 guest")).toBeVisible();
  // Email search works too.
  await search.fill(needle.email);
  await expect(guests).toHaveCount(1);
  await expect(guests.first()).toContainText(needle.name);
  expect(errors).toEqual([]);
  await context.close();
});

test("Teams pages 50 at a time with Load more", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`${dashboard()}?tab=guests&sub=teams`);
  const teams = page.getByRole("list", { name: "Teams", exact: true }).locator(":scope > li");
  await expect(teams).toHaveCount(50);
  await waitForHydration(page, "button");
  await page.getByRole("button", { name: "Load more teams" }).click();
  await expect(teams).toHaveCount(TEAMS);
  await expect(page.getByRole("button", { name: "Load more teams" })).toHaveCount(0);
  // Both ends of the list are loaded once, with no row repeated across pages.
  for (const index of [0, TEAMS - 1]) await expect(teams.filter({ hasText: teamName(index) })).toHaveCount(1);
  expect(errors).toEqual([]);
  await context.close();
});

test("Judging results page 50 ranked projects at a time; ranks carry across pages", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`${dashboard()}?tab=judging&sub=judging-results`);
  const table = page.getByRole("region", { name: "Ranked projects" });
  const bodyRows = table.locator("tbody tr");
  await expect(bodyRows).toHaveCount(50);
  await expect(shown(page, `Showing 1–50 of ${TEAMS} ranked projects`)).toBeVisible();
  await expect(bodyRows.first()).toContainText(projectTitle(0));
  const pager = page.getByRole("navigation", { name: "Ranking pages" });
  await expect(pager.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");

  await waitForHydration(page, 'nav[aria-label="Ranking pages"] button');
  await pager.getByRole("button", { name: "Page 2" }).click();
  await expect(bodyRows).toHaveCount(TEAMS - 50);
  await expect(shown(page, `Showing 51–${TEAMS} of ${TEAMS} ranked projects`)).toBeVisible();
  await expect(pager.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  // Projects 48–53 tie on 2/10: the rank computed over the whole ranking (49) carries onto page 2.
  await expect(bodyRows.first().locator("td").first()).toHaveText("49");
  await expect(table.getByText(projectTitle(TEAMS - 1))).toBeVisible();

  await pager.getByRole("button", { name: "Previous" }).click();
  await expect(bodyRows).toHaveCount(50);
  await expect(bodyRows.first()).toContainText(projectTitle(0));
  expect(errors).toEqual([]);
  await context.close();
});

test("Invites use numbered pages of 50 and a server search by email", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`${dashboard()}?tab=guests&sub=invites`);
  const invites = page.getByRole("list", { name: "Invited emails" }).locator(":scope > li");
  await expect(invites).toHaveCount(50);
  await expect(shown(page, `Showing 1–50 of ${INVITES} invites`)).toBeVisible();
  await expect(invites.filter({ hasText: inviteEmail(0) })).toHaveCount(0);
  const pager = page.getByRole("navigation", { name: "Invite pages" });
  await waitForHydration(page, 'nav[aria-label="Invite pages"] button');
  await pager.getByRole("button", { name: "Page 2" }).click();
  await expect(invites).toHaveCount(INVITES - 50);
  await expect(shown(page, `Showing 51–${INVITES} of ${INVITES} invites`)).toBeVisible();
  await expect(invites.filter({ hasText: inviteEmail(0) })).toHaveCount(1);
  await expect(pager.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("searchbox", { name: "Search invites by email" }).fill(`invite-00-${suffix}`);
  await expect(invites).toHaveCount(1);
  await expect(invites.first()).toContainText(inviteEmail(0));
  expect(errors).toEqual([]);
  await context.close();
});
