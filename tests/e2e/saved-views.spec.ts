import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPrivacyType, EventStatus, JudgingStatus, MembershipRole, PrismaClient, RegistrationMode, RsvpStatus, SoloPolicy, SubmissionStatus } from "@prisma/client";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Saved views (docs/FEATURES.md, "Saved views"): list filters live in the
// address bar, the Views menu applies presets and saved views, and a saved
// view can be shared, renamed and deleted. Data is seeded straight into the
// database: a TEAM event with a waitlisted, a checked-in and a not-yet-arrived
// guest, a team looking for members, and one team that hasn't submitted.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const password = "saved-views-journey-password";
const ownerEmail = `views-owner-${suffix}@example.test`;
const orgSlug = `views-${suffix}`;
const names = {
  waiting: `Wanda Waiting ${suffix}`,
  arrived: `Ari Arrived ${suffix}`,
  expected: `Ebo Expected ${suffix}`,
  seekers: `Seekers ${suffix}`,
  shipped: `Shipped ${suffix}`,
};

let ownerId = "";
let organisationId = "";
let eventId = "";
let ipCounter = 10;

async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  // Its own address block (198.18.9.x), so per-IP limits aren't shared with other specs.
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.18.9.${(ipCounter++ % 240) + 10}` });
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

async function ownerContext(browser: Browser) {
  if (!ownerSession) {
    const signInContext = await newContext(browser);
    await signIn(await signInContext.newPage());
    ownerSession = await signInContext.storageState();
    await signInContext.close();
  }
  const context = await newContext(browser, { storageState: ownerSession, permissions: ["clipboard-read", "clipboard-write"] });
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
// The organisation and account menus also start with "Views" (from the seeded names), so match the menu's own label.
const viewsButton = (page: Page) => page.getByRole("button", { name: /^Views(?:,|$)/ }).filter({ visible: true });

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  ownerId = (await prisma.user.create({ data: { email: ownerEmail, name: "Views Owner", passwordHash, emailVerified: new Date() } })).id;
  organisationId = (
    await prisma.organisation.create({ data: { name: `Views ${suffix}`, slug: orgSlug, memberships: { create: { userId: ownerId, role: MembershipRole.OWNER } } } })
  ).id;
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  eventId = (
    await prisma.event.create({
      data: {
        organisationId,
        title: `Views Hack ${suffix}`,
        slug: `views-${suffix}`,
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
  const person = (name: string, extra: { status?: RsvpStatus; checkedInAt?: Date } = {}) => {
    // Every name carries the suffix; slug the whole name so team leaders stay distinct.
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`;
    return prisma.rSVP.create({ data: { eventId, guestName: name, guestEmail: email, attendeeKey: `guest:${email}`, status: extra.status ?? RsvpStatus.CONFIRMED, checkedInAt: extra.checkedInAt } });
  };
  await person(names.waiting, { status: RsvpStatus.WAITLISTED });
  await person(names.arrived, { checkedInAt: new Date() });
  await person(names.expected);
  for (const [name, looking, submitted] of [
    [names.seekers, true, false],
    [names.shipped, false, true],
  ] as const) {
    const leader = await person(`Lead ${name}`);
    const team = await prisma.team.create({
      data: { eventId, name, nameKey: name.toLowerCase(), status: RsvpStatus.CONFIRMED, joinToken: randomBytes(16).toString("hex"), manageTokenHash: randomBytes(32).toString("hex"), leaderRsvpId: leader.id, lookingForMembers: looking },
    });
    await prisma.rSVP.update({ where: { id: leader.id }, data: { teamId: team.id } });
    if (submitted) await prisma.submission.create({ data: { eventId, teamId: team.id, title: `Project ${suffix}`, status: SubmissionStatus.SUBMITTED, submittedAt: new Date() } });
  }
});

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

test("People filters come from the address bar and the Views menu writes them back", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  // Keys outside the People allow-list (a cursor, another organisation) are ignored.
  await page.goto(`${dashboard()}?tab=guests&sub=people&status=waitlist&cursor=forged&organisationId=other`);
  const guests = page.getByRole("list", { name: "Guests" }).locator(":scope > li");
  await expect(guests).toHaveCount(1);
  await expect(guests.first()).toContainText(names.waiting);
  await expect(page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Waitlist/ })).toHaveAttribute("aria-pressed", "true");
  await expect(viewsButton(page)).toContainText("Waitlisted");

  await waitForHydration(page, "button");
  await viewsButton(page).click();
  await page.getByRole("menuitem", { name: "Not checked in" }).click();
  await expect(guests.filter({ hasText: names.expected })).toHaveCount(1);
  await expect(guests.filter({ hasText: names.arrived })).toHaveCount(0);
  await expect(guests.filter({ hasText: names.waiting })).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("notCheckedIn");

  // Copy link holds the tab, sub-tab and filters.
  await viewsButton(page).click();
  await page.getByRole("menuitem", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied").first()).toBeVisible();
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(Object.fromEntries(copied.searchParams)).toMatchObject({ tab: "guests", sub: "people", status: "notCheckedIn" });

  // Switching sub-tab drops the People filters from the address.
  await page.getByRole("tab", { name: /^Teams/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBeNull();
  expect(errors).toEqual([]);
  await context.close();
});

test("Save, share, apply, rename and delete a Teams view", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`${dashboard()}?tab=guests&sub=teams`);
  const teams = page.getByRole("list", { name: "Teams", exact: true }).locator(":scope > li");
  await expect(teams).toHaveCount(2);
  await waitForHydration(page, "button");

  await viewsButton(page).click();
  await page.getByRole("menuitem", { name: "Looking for members" }).click();
  await expect(teams).toHaveCount(1);
  await expect(teams.first()).toContainText(names.seekers);

  await viewsButton(page).click();
  await page.getByRole("menuitem", { name: "Save current view…" }).click();
  const save = page.getByRole("dialog", { name: "Save view" });
  await save.getByRole("textbox", { name: /Name/ }).fill("Recruiting teams");
  await save.getByRole("checkbox", { name: /Share with the team/ }).check();
  await save.getByRole("button", { name: "Save view" }).click();
  await expect(page.getByText("View saved and shared").first()).toBeVisible();
  await expect(viewsButton(page)).toContainText("Looking for members");

  // A fresh, unfiltered visit lists the saved view; applying it filters again.
  await page.goto(`${dashboard()}?tab=guests&sub=teams`);
  await expect(teams).toHaveCount(2);
  await waitForHydration(page, "button");
  await viewsButton(page).click();
  await expect(page.getByRole("menuitem", { name: /Recruiting teams/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Recruiting teams/ }).click();
  await expect(teams).toHaveCount(1);
  await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("looking");

  await viewsButton(page).click();
  await page.getByRole("menuitem", { name: "Manage views…" }).click();
  const manage = page.getByRole("dialog", { name: "Manage views" });
  await manage.getByRole("button", { name: "Rename Recruiting teams" }).click();
  await manage.getByRole("textbox", { name: /New name/ }).fill("Seeking members");
  await manage.getByRole("button", { name: "Save", exact: true }).click();
  await expect(manage.getByText("Seeking members")).toBeVisible();
  await manage.getByRole("button", { name: "Delete Seeking members" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete view" }).click();
  await expect(manage.getByText("No saved views yet.")).toBeVisible();
  expect(await prisma.savedView.count({ where: { eventId } })).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("Judging Submissions: the Not submitted preset lists entrants without a submitted project", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`${dashboard()}?tab=judging&sub=judging-submissions&status=notSubmitted`);
  const entrants = page.getByRole("list", { name: "Entrants without a submitted project" }).locator(":scope > li");
  await expect(entrants.filter({ hasText: names.seekers })).toHaveCount(1);
  await expect(entrants.filter({ hasText: names.shipped })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Not submitted/ })).toBeVisible();
  await expect(viewsButton(page)).toContainText("Not submitted");

  // Results: the Unscored preset, from the address bar.
  await page.goto(`${dashboard()}?tab=judging&sub=judging-results&scored=unscored`);
  await expect(page.getByRole("region", { name: "Ranked projects" }).locator("tbody tr")).toHaveCount(1);
  await expect(viewsButton(page)).toContainText("Unscored");

  // Progress: Below target shows only that list.
  await page.goto(`${dashboard()}?tab=judging&sub=judging-progress&show=below-target`);
  await expect(page.getByRole("heading", { name: "Projects below target" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Outlier scores" })).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});
