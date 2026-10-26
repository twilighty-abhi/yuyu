import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPermission, EventPrivacyType, EventStatus, JudgingStatus, MembershipRole, PrismaClient, RegistrationMode, RsvpStatus, SubmissionStatus } from "@prisma/client";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Judging → Progress and automatic judge assignment (docs/HACKATHON.md): the
// organiser previews and applies an even assignment that skips a judge's own
// project, then reads the progress lists (below target, judges, outliers,
// stale reviews). A JUDGE-only collaborator never sees the Progress view.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const password = "judging-ops-password";
const ownerEmail = `judging-ops-owner-${suffix}@example.test`;
const judges = ["Avery", "Blake", "Casey"].map((name) => ({ name: `${name} Judge`, email: `judging-ops-${name.toLowerCase()}-${suffix}@example.test`, id: "" }));
const orgSlug = `judging-ops-${suffix}`;
let ownerId = "";
let organisationId = "";
let eventId = "";
let criterionId = "";
const projectIds: string[] = [];
let ipCounter = 10;

const dashboard = () => `/dashboard/${orgSlug}/event/${eventId}`;

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  // Its own TEST-NET-2 range, apart from the other judging specs.
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.51.100.${(ipCounter++ % 40) + 200}` });
  return { context, page: await context.newPage() };
}

async function waitForHydration(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).first().evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
}

async function signIn(page: Page, email: string) {
  await page.request.get("/api/auth/csrf");
  await page.goto("/login");
  const emailInput = page.getByRole("textbox", { name: /^Email/ });
  await waitForHydration(page, 'input[type="password"]');
  await emailInput.fill(email);
  await page.locator('input[type="password"]:visible').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname.startsWith("/login"), { timeout: 60_000 }).toBe(false);
}

// The dashboard renders each tab panel for two layouts; only one is visible.
function section(page: Page, heading: string) {
  return page.locator("section", { has: page.getByRole("heading", { name: heading, exact: true }) }).filter({ visible: true });
}

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  ownerId = (await prisma.user.create({ data: { email: ownerEmail, name: "Ops Owner", passwordHash, emailVerified: new Date() } })).id;
  for (const judge of judges) judge.id = (await prisma.user.create({ data: { email: judge.email, name: judge.name, passwordHash, emailVerified: new Date() } })).id;
  organisationId = (
    await prisma.organisation.create({ data: { name: `Judging ops ${suffix}`, slug: orgSlug, memberships: { create: { userId: ownerId, role: MembershipRole.OWNER } } } })
  ).id;
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  eventId = (
    await prisma.event.create({
      data: {
        organisationId,
        title: `Ops Hack ${suffix}`,
        slug: `ops-hack-${suffix}`,
        startDateTime: start,
        endDateTime: new Date(start.getTime() + 24 * 60 * 60 * 1000),
        timezone: "UTC",
        status: EventStatus.PUBLISHED,
        privacyType: EventPrivacyType.PUBLIC,
        registrationMode: RegistrationMode.INDIVIDUAL,
        submissionsEnabled: true,
        judgingStatus: JudgingStatus.OPEN,
        page: { create: { isPublished: true } },
      },
    })
  ).id;
  criterionId = (await prisma.judgingCriterion.create({ data: { eventId, name: "Impact", weight: 1, maxScore: 10 } })).id;
  for (const judge of judges) await prisma.eventCollaborator.create({ data: { eventId, userId: judge.id, permissions: [EventPermission.JUDGE] } });
  for (let index = 0; index < 6; index += 1) {
    // The first project belongs to Avery, a judge: a conflict of interest.
    const ownedByJudge = index === 0;
    const email = `judging-ops-entrant-${index}-${suffix}@example.test`;
    const rsvp = await prisma.rSVP.create({
      data: ownedByJudge
        ? { eventId, userId: judges[0]!.id, attendeeKey: `user:${judges[0]!.id}`, status: RsvpStatus.CONFIRMED }
        : { eventId, attendeeKey: `guest:${email}`, guestEmail: email, guestName: `Entrant ${index}`, status: RsvpStatus.CONFIRMED },
    });
    projectIds.push((await prisma.submission.create({ data: { eventId, rsvpId: rsvp.id, title: `Ops Project ${index} ${suffix}`, status: SubmissionStatus.SUBMITTED, submittedAt: new Date() } })).id);
  }
});

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, ...judges.map((judge) => judge.id)].filter(Boolean) } } });
  await prisma.$disconnect();
});

test("the organiser previews and applies an automatic assignment from Progress", async ({ browser }) => {
  const { context, page } = await newPage(browser);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, ownerEmail);
  await page.goto(`${dashboard()}?tab=judging&sub=judging-progress`);
  await waitForHydration(page, "button");
  await expect(page.getByRole("tab", { name: "Progress" }).filter({ visible: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Aiming for 3 judges per project (the default; set your own target below).").filter({ visible: true })).toBeVisible();
  await expect(section(page, "Projects below target")).toContainText("Showing 1–6 of 6 projects");
  await expect(section(page, "Judges")).toContainText("Avery Judge");

  await page.getByRole("button", { name: "Assign judges automatically" }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Assign judges automatically" });
  await dialog.getByLabel("Judges per project").fill("2");
  // Invited judges are ticked by default; organisers only when picked.
  for (const judge of judges) await expect(dialog.getByRole("checkbox", { name: new RegExp(judge.name) })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Ops Owner/ })).not.toBeChecked();
  await dialog.getByRole("button", { name: "Preview" }).click();
  const preview = dialog.getByTestId("auto-assign-preview");
  await expect(preview.getByRole("status")).toHaveText("Every one of the 6 submitted projects gets 2 judges. 12 new assignments.");
  await expect(preview).toContainText("Judges will then see only the projects assigned to them");
  await expect(preview.getByRole("region", { name: "Assignments per judge" }).getByRole("row")).toHaveCount(4);
  // Nothing is written by a preview.
  expect(await prisma.judgeAssignment.count({ where: { eventId } })).toBe(0);

  await dialog.getByRole("button", { name: "Apply assignment" }).click();
  await expect(page.getByText("Judges assigned: 12 added.")).toBeVisible();
  await expect(dialog).toBeHidden();
  const rows = await prisma.judgeAssignment.findMany({ where: { eventId }, select: { judgeUserId: true, submissionId: true } });
  expect(rows).toHaveLength(12);
  expect(rows).not.toContainEqual({ judgeUserId: judges[0]!.id, submissionId: projectIds[0] });
  const loads = judges.map((judge) => rows.filter((row) => row.judgeUserId === judge.id).length);
  expect(loads).toEqual([4, 4, 4]);
  expect(await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { judgesSeeAll: true, reviewsPerProject: true } })).toEqual({ judgesSeeAll: false, reviewsPerProject: 2 });

  await expect(page.getByText("Aiming for 2 judges per project.").filter({ visible: true })).toBeVisible();
  await expect(section(page, "Judges")).toContainText("Avery Judge");
  await expect(page.getByLabel("Target judges per project").filter({ visible: true })).toHaveValue("2");
  expect(errors).toEqual([]);
  await context.close();
});

test("Progress flags outlier scores and stale reviews", async ({ browser }) => {
  const [avery, blake, casey] = judges as [(typeof judges)[0], (typeof judges)[0], (typeof judges)[0]];
  // Project 1: Blake 90, Casey 50 (two judges more than 25 points apart).
  for (const [judge, score] of [[blake, 9], [casey, 5]] as const) {
    await prisma.judgeScore.create({ data: { submissionId: projectIds[1]!, judgeUserId: judge.id, criterionId, score } });
    await prisma.judgeReview.create({ data: { submissionId: projectIds[1]!, judgeUserId: judge.id, submittedAt: new Date() } });
  }
  // Project 2: Avery saved a score two days ago and never submitted.
  await prisma.judgeScore.create({ data: { submissionId: projectIds[2]!, judgeUserId: avery.id, criterionId, score: 6 } });
  await prisma.$executeRaw`UPDATE "JudgeScore" SET "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '2 days' WHERE "submissionId" = ${projectIds[2]!}`;

  const { context, page } = await newPage(browser);
  await signIn(page, ownerEmail);
  await page.goto(`${dashboard()}?tab=judging&sub=judging-progress`);
  await waitForHydration(page, "button");
  const outliers = section(page, "Outlier scores");
  await expect(outliers).toContainText(`Ops Project 1 ${suffix}`);
  await expect(outliers.getByRole("row")).toHaveCount(3);
  await expect(outliers).toContainText("+40 points");
  const stale = section(page, "Stale reviews");
  await expect(stale).toContainText(`Ops Project 2 ${suffix}`);
  await expect(stale).toContainText("Avery Judge");
  await expect(section(page, "Projects below target")).toContainText("Showing 1–5 of 5 projects");
  // At phone width the tables scroll inside their own boxes; the outlier
  // chip's screen-reader text used to stick out and widen the whole page.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(outliers).toContainText("+40 points");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await context.close();
});

test("a JUDGE-only collaborator never sees Progress", async ({ browser }) => {
  const { context, page } = await newPage(browser);
  await signIn(page, judges[1]!.email);
  await page.goto(`${dashboard()}?tab=judging&sub=judging-progress`);
  await expect(page.getByRole("tab", { name: "Progress" })).toHaveCount(0);
  await expect(page.getByText("Assign judges automatically")).toHaveCount(0);
  await context.close();
});
