import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import {
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

// Filtered CSV exports, the paged feedback responses, and the dashboard's
// streamed panels (docs/TEAMS.md, docs/HACKATHON.md). Each "Export CSV" link
// carries the list's current filters, and the server answers with exactly
// the matching rows; the Feedback responses list pages on the server; and a
// dashboard panel is rendered once, never left behind as a hidden server
// copy next to a client-rendered one.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const password = "filtered-exports-password";
const ownerEmail = `exports-owner-${suffix}@example.test`;
const orgSlug = `exports-${suffix}`;
const TEAMS = 12;
const RESPONSES = 30;
const teamName = (index: number) => `Export Team ${String(index).padStart(2, "0")} ${suffix}`;
const projectTitle = (index: number) => `Export Project ${String(index).padStart(2, "0")} ${suffix}`;

let ownerId = "";
let organisationId = "";
let eventId = "";
let ipCounter = 10;

async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  // Its own TEST-NET-2 block so per-IP limits are not shared with other specs.
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.18.9.${(ipCounter++ % 240) + 10}` });
  return context;
}

async function signIn(page: Page) {
  await page.request.get("/api/auth/csrf");
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

async function waitForHydration(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).filter({ visible: true }).first().evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
}

/** CSV data rows (header dropped), split on commas: the cells checked here hold no commas. */
async function csvRows(page: Page, href: string) {
  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  const lines = (await response.text()).replace(/^﻿/, "").trim().split("\n");
  return lines.slice(1).map((line) => line.split(","));
}

const dashboard = () => `/dashboard/${orgSlug}/event/${eventId}`;

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  ownerId = (await prisma.user.create({ data: { email: ownerEmail, name: "Exports Owner", passwordHash, emailVerified: new Date() } })).id;
  organisationId = (
    await prisma.organisation.create({
      data: { name: `Exports ${suffix}`, slug: orgSlug, memberships: { create: { userId: ownerId, role: MembershipRole.OWNER } } },
    })
  ).id;
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  eventId = (
    await prisma.event.create({
      data: {
        organisationId,
        title: `Export Hack ${suffix}`,
        slug: `export-hack-${suffix}`,
        startDateTime: start,
        endDateTime: new Date(start.getTime() + 24 * 60 * 60 * 1000),
        timezone: "UTC",
        status: EventStatus.PUBLISHED,
        privacyType: EventPrivacyType.PUBLIC,
        registrationMode: RegistrationMode.TEAM,
        teamMinSize: 1,
        teamMaxSize: 4,
        soloPolicy: SoloPolicy.SOLO_ALLOWED,
        submissionsEnabled: true,
        judgesSeeAll: true,
        judgingStatus: JudgingStatus.OPEN,
        page: { create: { isPublished: true } },
      },
    })
  ).id;
  const base = Date.now() - 10 * 60 * 60 * 1000;
  // Twelve one-person teams: the even ones going, the odd ones waitlisted;
  // every team has a project, submitted for the first eight.
  for (let index = 0; index < TEAMS; index += 1) {
    const status = index % 2 === 0 ? RsvpStatus.CONFIRMED : RsvpStatus.WAITLISTED;
    const email = `exports-leader-${index}-${suffix}@example.test`;
    const createdAt = new Date(base + index * 60_000);
    const leader = await prisma.rSVP.create({ data: { eventId, guestName: `Leader ${index} ${suffix}`, guestEmail: email, attendeeKey: `guest:${email}`, status, createdAt } });
    const team = await prisma.team.create({
      data: { eventId, name: teamName(index), nameKey: teamName(index).toLowerCase(), status, joinToken: randomUUID(), manageTokenHash: randomUUID(), leaderRsvpId: leader.id, createdAt },
    });
    await prisma.rSVP.update({ where: { id: leader.id }, data: { teamId: team.id } });
    await prisma.submission.create({
      data: { eventId, teamId: team.id, title: projectTitle(index), status: index < 8 ? SubmissionStatus.SUBMITTED : SubmissionStatus.DRAFT, createdAt, submittedAt: index < 8 ? createdAt : null },
    });
  }
  // Feedback: more responses than one page of 25.
  const form = await prisma.eventFeedbackForm.create({ data: { eventId, isOpen: true } });
  const field = await prisma.eventFeedbackField.create({ data: { formId: form.id, key: "comment", label: "Comment", type: "TEXT", sortOrder: 0 } });
  for (let index = 0; index < RESPONSES; index += 1) {
    await prisma.eventFeedbackResponse.create({
      data: {
        formId: form.id,
        certificateToken: null,
        submittedAt: new Date(base + index * 60_000),
        answers: { create: [{ fieldId: field.id, fieldKey: "comment", fieldLabel: "Comment", fieldType: "TEXT", valueText: `Feedback ${index} ${suffix}` }] },
      },
    });
  }
});

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

test("the dashboard renders a streamed panel once, never leaving a hidden server copy beside the client one", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  // Record, from the first byte, the most #guest-search inputs present at once.
  await page.addInitScript(() => {
    const state = { max: 0 };
    (window as unknown as { __guestSearch: typeof state }).__guestSearch = state;
    new MutationObserver(() => {
      state.max = Math.max(state.max, document.querySelectorAll("#guest-search").length);
    }).observe(document, { childList: true, subtree: true });
  });
  for (let visit = 0; visit < 3; visit += 1) {
    await page.goto(`${dashboard()}?tab=guests&sub=people`);
    await waitForHydration(page, "#guest-search");
    // Past React's batched reveal of streamed content.
    await page.waitForTimeout(2_500);
    await expect(page.locator("#guest-search")).toHaveCount(1);
    await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __guestSearch: { max: number } }).__guestSearch.max)).toBe(1);
  }
  await context.close();
});

test("People, Teams and Judging export exactly the filters showing", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  // Guests · People: the Waitlist chip narrows the CSV link.
  await page.goto(`${dashboard()}?tab=guests&sub=people`);
  await waitForHydration(page, "#guest-search");
  const peopleExport = page.getByRole("link", { name: "Export CSV" });
  await expect(peopleExport).toHaveAttribute("href", `/api/exports/events/${eventId}/attendees`);
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Waitlist/ }).click();
  await expect(peopleExport).toHaveAttribute("href", `/api/exports/events/${eventId}/attendees?status=waitlist`);
  const waitlisted = await csvRows(page, (await peopleExport.getAttribute("href"))!);
  expect(waitlisted).toHaveLength(TEAMS / 2);
  expect(waitlisted.every((row) => row[2] === "WAITLISTED")).toBe(true);

  // Guests · Teams: the search narrows the CSV link.
  await page.goto(`${dashboard()}?tab=guests&sub=teams`);
  await waitForHydration(page, "#team-search");
  await page.locator("#team-search").fill(teamName(3));
  const teamsExport = page.getByRole("link", { name: "Export CSV" });
  await expect(teamsExport).toHaveAttribute("href", new RegExp(`/teams\\?q=`));
  const teams = await csvRows(page, (await teamsExport.getAttribute("href"))!);
  expect(teams.map((row) => row[0])).toEqual([teamName(3)]);
  expect(teams[0]![8]).toBe("SUBMITTED");

  // Judging → Submissions: the Drafts chip narrows the CSV link.
  await page.goto(`${dashboard()}?tab=judging&sub=judging-submissions`);
  await waitForHydration(page, 'input[aria-label="Search projects"]');
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Drafts/ }).click();
  const submissionsExport = page.getByRole("link", { name: "Export CSV" });
  await expect(submissionsExport).toHaveAttribute("href", `/api/exports/events/${eventId}/judging?view=submissions&status=DRAFT`);
  const drafts = await csvRows(page, (await submissionsExport.getAttribute("href"))!);
  expect(drafts.map((row) => row[0]).sort()).toEqual([8, 9, 10, 11].map(projectTitle));

  // Judging → Results: the search and the score method go with the CSV link.
  await page.goto(`${dashboard()}?tab=judging&sub=judging-results`);
  await waitForHydration(page, 'input[aria-label="Search ranked projects"]');
  await page.getByRole("searchbox", { name: "Search ranked projects" }).fill(projectTitle(5));
  const resultsExport = page.getByRole("link", { name: "Export CSV" });
  await expect(resultsExport).toHaveAttribute("href", new RegExp(`/judging\\?q=.*&method=RAW$`));
  const results = await csvRows(page, (await resultsExport.getAttribute("href"))!);
  expect(results.map((row) => row[1])).toEqual([projectTitle(5)]);
  expect(errors).toEqual([]);
  await context.close();
});

test("Feedback responses page on the server, 25 at a time", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  await page.goto(`${dashboard()}?tab=feedback`);
  const toggle = page.getByRole("button", { name: "Show individual responses" });
  await waitForHydration(page, 'button[aria-expanded="false"]');
  await toggle.click();
  const list = page.getByRole("region", { name: "All feedback responses" });
  await expect(list.getByText(`Showing 1–25 of ${RESPONSES} responses`)).toBeVisible();
  await expect(list.getByText(`Response ${RESPONSES} ·`)).toBeVisible();
  const pager = list.getByRole("navigation", { name: "Response pages" });
  await pager.getByRole("button", { name: "Page 2" }).click();
  await expect(list.getByText(`Showing 26–${RESPONSES} of ${RESPONSES} responses`)).toBeVisible();
  await expect(list.getByText("Response 1 ·")).toBeVisible();
  await expect(pager.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await context.close();
});
