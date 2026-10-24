import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPermission, EventPrivacyType, EventStatus, MembershipRole, PrismaClient, RegistrationMode } from "@prisma/client";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Hackathon judging journey (docs/HACKATHON.md): the organiser turns project
// submissions on, builds a rubric, two teams and a solo registrant submit, a
// JUDGE-only collaborator scores with the keyboard, and the organiser closes
// judging, picks a winner and publishes the results. One ordered story.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const password = "judging-journey-password";
const ownerEmail = `judging-owner-${suffix}@example.test`;
const judgeEmail = `judging-judge-${suffix}@example.test`;
const orgSlug = `judging-${suffix}`;
const eventSlug = `hack-${suffix}`;
const eventTitle = `Judged Hack ${suffix}`;
const teams = {
  alpha: { team: `Alpha ${suffix}`, project: `Alpha Project ${suffix}`, leader: { name: "Ada Alpha", email: `judging-alpha-${suffix}@example.test` } },
  beta: { team: `Beta ${suffix}`, project: `Beta Project ${suffix}`, leader: { name: "Ben Beta", email: `judging-beta-${suffix}@example.test` } },
};
const solo = { name: "Sol Solo", email: `judging-solo-${suffix}@example.test` };
const testEmails = [ownerEmail, judgeEmail, teams.alpha.leader.email, teams.beta.leader.email, solo.email];

let ownerId = "";
let judgeId = "";
let organisationId = "";
let eventId = "";
let ipCounter = 10;
const manageTokens: Record<string, string> = {};

async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.51.100.${(ipCounter++ % 200) + 20}` });
  return context;
}

async function waitForHydration(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).first().evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
}

async function signIn(page: Page, email: string) {
  await page.request.get("/api/auth/csrf");
  await page.request.get("/api/auth/session");
  for (let attempt = 1; ; attempt++) {
    await page.goto("/login");
    const emailInput = page.getByRole("textbox", { name: /^Email/ });
    await expect.poll(() => emailInput.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
    await emailInput.fill(email);
    await page.locator('input[type="password"]:visible').fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const failed = page.getByRole("alert").filter({ hasText: "Invalid email or password" });
    await expect.poll(async () => !new URL(page.url()).pathname.startsWith("/login") || (await failed.count()) > 0, { timeout: 60_000 }).toBe(true);
    if (!new URL(page.url()).pathname.startsWith("/login")) return;
    if (attempt === 3) throw new Error(`Sign-in failed three times for ${email}`);
  }
}

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const sessions = new Map<string, StorageState>();

async function userContext(browser: Browser, email: string) {
  if (!sessions.has(email)) {
    const signInContext = await newContext(browser);
    await signIn(await signInContext.newPage(), email);
    sessions.set(email, await signInContext.storageState());
    await signInContext.close();
  }
  const context = await newContext(browser, { storageState: sessions.get(email) });
  return { context, page: await context.newPage() };
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

type Payload = Record<string, unknown>;
async function outboxPayload(kind: string, match: (payload: Payload) => boolean): Promise<Payload> {
  let found: Payload | undefined;
  await expect
    .poll(async () => {
      const rows = await prisma.outboxMessage.findMany({ where: { kind }, orderBy: { createdAt: "desc" }, select: { payload: true } });
      found = rows.map((row) => row.payload as Payload).find((payload) => payload && match(payload));
      return Boolean(found);
    }, { message: `waiting for a queued ${kind} email` })
    .toBe(true);
  return found!;
}

/** Registrations queue real emails; drop them before any worker pass can send to test addresses. */
async function discardQueuedTestEmail() {
  const messages = await prisma.outboxMessage.findMany({ select: { id: true, payload: true } });
  const ids = messages.filter((message) => testEmails.includes(String((message.payload as Payload | null)?.to))).map((message) => message.id);
  if (ids.length) await prisma.outboxMessage.deleteMany({ where: { id: { in: ids } } });
}

const dashboard = () => `/dashboard/${orgSlug}/event/${eventId}`;

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  ownerId = (await prisma.user.create({ data: { email: ownerEmail, name: "Judging Owner", passwordHash, emailVerified: new Date() } })).id;
  judgeId = (await prisma.user.create({ data: { email: judgeEmail, name: "Jude Judge", passwordHash, emailVerified: new Date() } })).id;
  organisationId = (
    await prisma.organisation.create({
      data: { name: `Judging ${suffix}`, slug: orgSlug, memberships: { create: { userId: ownerId, role: MembershipRole.OWNER } } },
    })
  ).id;
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  eventId = (
    await prisma.event.create({
      data: {
        organisationId,
        title: eventTitle,
        slug: eventSlug,
        startDateTime: start,
        endDateTime: new Date(start.getTime() + 24 * 60 * 60 * 1000),
        timezone: "UTC",
        location: "Makerspace",
        status: EventStatus.PUBLISHED,
        privacyType: EventPrivacyType.PUBLIC,
        registrationMode: RegistrationMode.TEAM,
        teamMinSize: 1,
        teamMaxSize: 4,
        page: { create: { isPublished: true, aboutHtml: "<p>Build and get judged.</p>" } },
      },
    })
  ).id;
  // The judge is a JUDGE-only event collaborator (no organisation membership).
  await prisma.eventCollaborator.create({ data: { eventId, userId: judgeId, permissions: [EventPermission.JUDGE] } });
});

test.afterAll(async () => {
  await discardQueuedTestEmail();
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, judgeId].filter(Boolean) } } });
  await prisma.$disconnect();
});

test("the organiser turns submissions on in Settings and is pointed to the new Judging tab", async ({ browser }) => {
  const { context, page } = await userContext(browser, ownerEmail);
  const errors = collectPageErrors(page);
  // While the event is a draft, switching submissions on warns that entrants can't submit yet.
  await prisma.event.update({ where: { id: eventId }, data: { status: EventStatus.DRAFT } });
  await page.goto(`${dashboard()}?tab=settings`);
  await expect(page.getByRole("tab", { name: "Judging", exact: true })).toHaveCount(0);
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Project submissions" }) });
  await waitForHydration(page, 'button[role="switch"]');
  // The embed snippets gain the absolute origin once hydrated, without a hydration mismatch.
  await expect(page.locator("details code, details pre").first()).toContainText(new URL(page.url()).origin);
  await expect(card.getByText("This event is still a draft.")).toHaveCount(0);
  await card.getByRole("switch", { name: /Projects and judging/ }).click();
  await expect(card.getByText("This event is still a draft.")).toBeVisible();
  await expect(card.getByText(/can't see the submission form, or submit, until you publish/)).toBeVisible();
  await prisma.event.update({ where: { id: eventId }, data: { status: EventStatus.PUBLISHED } });
  await card.getByLabel(/^Opens/).fill(new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 16));
  await card.getByLabel(/^Closes/).fill(new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString().slice(0, 16));
  await card.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/Project submissions are on\. .*Judging tab/).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Judging", exact: true })).toBeVisible();

  // Results before judging starts: the hint says to open judging first, not to close it.
  await page.goto(`${dashboard()}?tab=judging&sub=judging-results`);
  await expect(page.getByText(/Judging hasn't started\. Open judging on the Setup tab/).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Close judging on the Setup tab before you publish results.")).toHaveCount(0);

  // The organiser's own Score tab speaks to them as the organiser and links to the rubric.
  await page.goto(`${dashboard()}?tab=judging&sub=judging-score`);
  await waitForHydration(page, "button");
  await expect(page.getByText("The organisers have not added judging criteria")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit the rubric" }).click();
  await expect(page.getByRole("tab", { name: "Setup" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Add criterion" })).toBeVisible();

  // Judges: the invited JUDGE collaborator is listed apart from the organisers.
  await page.goto(`${dashboard()}?tab=judging&sub=judging-judges`);
  const invited = page.locator("section", { has: page.getByRole("heading", { name: "Invited judges" }) });
  const organisers = page.locator("section", { has: page.getByRole("heading", { name: "Organisers who can also judge" }) });
  await expect(invited).toContainText("Jude Judge");
  await expect(invited).not.toContainText("Judging Owner");
  await expect(organisers).toContainText("Judging Owner");

  // The live event shows no draft warning.
  await page.goto(`${dashboard()}?tab=judging&sub=judging-setup`);
  await waitForHydration(page, "button");
  await expect(page.getByText("This event is still a draft.")).toHaveCount(0);
  for (const criterion of [
    { name: "Impact", weight: "2", max: "10" },
    { name: "Execution", weight: "1", max: "5" },
  ]) {
    await page.getByRole("button", { name: "Add criterion" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^Name/).fill(criterion.name);
    await dialog.getByLabel(/^Weight/).fill(criterion.weight);
    await dialog.getByLabel(/^Maximum score/).fill(criterion.max);
    await dialog.getByRole("button", { name: "Add criterion" }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect.poll(() => prisma.judgingCriterion.count({ where: { eventId } })).toBe(2);
  expect(errors).toEqual([]);
  await context.close();
});

test("teams submit from their team page and a solo registrant through the emailed link", async ({ browser }) => {
  const context = await newContext(browser);
  for (const entry of Object.values(teams)) {
    const response = await context.request.post("/api/rsvp", {
      data: { orgSlug, eventSlug, guestEmail: entry.leader.email, name: entry.leader.name, answers: {}, team: { mode: "create", name: entry.team } },
    });
    expect(response.status(), await response.text()).toBe(200);
    const team = await prisma.team.findFirstOrThrow({ where: { eventId, name: entry.team } });
    manageTokens[entry.team] = String((await outboxPayload("team-created", (payload) => payload.teamId === team.id)).manageToken);

    const page = await context.newPage();
    await page.goto(`/team/${manageTokens[entry.team]}`);
    const card = page.getByRole("region", { name: "Team project" });
    await waitForHydration(page, "form button");
    await card.getByLabel(/^Project title/).fill(entry.project);
    await card.getByLabel(/^Code repository/).fill("http://example.com/insecure");
    await card.getByRole("button", { name: "Submit project" }).click();
    await expect(card.getByText("Use a full https:// link")).toBeVisible();
    await card.getByLabel(/^Code repository/).fill("https://example.com/code");
    await card.getByRole("button", { name: "Submit project" }).click();
    await expect(card.getByText(/Project submitted/)).toBeVisible();
    await page.close();
  }

  const response = await context.request.post("/api/rsvp", { data: { orgSlug, eventSlug, guestEmail: solo.email, name: solo.name, answers: {}, team: { mode: "solo" } } });
  expect(response.status(), await response.text()).toBe(200);
  const rsvp = await prisma.rSVP.findFirstOrThrow({ where: { eventId, guestEmail: solo.email } });
  const ticket = await context.newPage();
  await ticket.goto(`/ticket/${rsvp.checkInToken}`);
  await waitForHydration(ticket, "section button");
  await ticket.getByRole("button", { name: "Email me my submission link" }).click();
  const token = String((await outboxPayload("submission-link", (payload) => payload.rsvpId === rsvp.id)).token);
  const page = await context.newPage();
  await page.goto(`/submit/${token}`);
  // The solo project page has Yuyu's site chrome: a main landmark for the skip link.
  await expect(page.locator("main#main-content")).toContainText("Your project");
  await waitForHydration(page, "form button");
  await page.getByLabel(/^Project title/).fill(`Solo Project ${suffix}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft saved/)).toBeVisible();
  expect(await prisma.submission.count({ where: { eventId, status: "SUBMITTED" } })).toBe(2);
  // Crawlers are kept off the solo submission link like the other capability links.
  expect(await (await context.request.get("/robots.txt")).text()).toContain("Disallow: /submit/");
  await discardQueuedTestEmail();
  await context.close();
});

test("a JUDGE-only collaborator scores with the keyboard; focus follows the scoring view", async ({ browser }) => {
  await prisma.event.update({ where: { id: eventId }, data: { judgingStatus: "OPEN" } });
  const { context, page } = await userContext(browser, judgeEmail);
  const errors = collectPageErrors(page);
  await page.goto(`${dashboard()}?tab=guests`);
  await expect(page.getByRole("heading", { name: "Score submissions" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(0);
  expect(await page.content()).not.toContain(teams.alpha.leader.email);
  await waitForHydration(page, "li button");

  const scores = { [teams.alpha.project]: { Impact: 8, Execution: 4 }, [teams.beta.project]: { Impact: 5, Execution: 5 } };
  for (const [project, byCriterion] of Object.entries(scores)) {
    const opener = page.getByRole("button", { name: new RegExp(project) });
    await opener.focus();
    await page.keyboard.press("Enter");
    const heading = page.getByRole("heading", { name: project });
    await expect(heading).toBeFocused();
    for (const [criterion, score] of Object.entries(byCriterion)) {
      const max = criterion === "Impact" ? 10 : 5;
      await page.getByRole("group", { name: criterion, exact: true }).getByRole("radio", { name: `${score} out of ${max}` }).check({ force: true });
    }
    await page.getByLabel(/^Private comment/).fill(`Private note on ${project}`);
    await page.getByRole("button", { name: "Submit review" }).click();
    await expect(page.getByText("Review submitted").first()).toBeVisible();
    await page.getByRole("button", { name: "All submissions" }).click();
    await expect(page.getByRole("button", { name: new RegExp(project) })).toBeFocused();
  }
  await expect.poll(() => prisma.judgeReview.count({ where: { judgeUserId: judgeId, submittedAt: { not: null } } })).toBe(2);
  expect(errors).toEqual([]);
  await context.close();
});

test("the organiser closes judging, ranks, awards and publishes once", async ({ browser }) => {
  const { context, page } = await userContext(browser, ownerEmail);
  await page.goto(`${dashboard()}?tab=judging&sub=judging-setup`);
  await waitForHydration(page, "button");
  await page.getByRole("button", { name: /^Close judging/ }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: /^Close judging$/ }).click();
  await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).judgingStatus).toBe("CLOSED");

  await page.goto(`${dashboard()}?tab=judging&sub=judging-results`);
  const rows = page.getByRole("region", { name: "Ranked projects" }).getByRole("row");
  await expect(rows.nth(1)).toContainText(teams.alpha.project);
  await expect(rows.nth(1)).toContainText("80.0");
  await expect(rows.nth(2)).toContainText("66.7");

  await page.goto(`${dashboard()}?tab=judging&sub=judging-awards`);
  await waitForHydration(page, "button");
  await page.getByRole("button", { name: "Add award" }).click();
  await page.getByRole("dialog").getByLabel(/^Name/).fill("Overall winner");
  await page.getByRole("dialog").getByRole("button", { name: "Add award" }).click();
  await page.getByRole("button", { name: "Pick a winner" }).click();
  const picker = page.getByRole("dialog", { name: "Pick a winner" });
  await expect(picker.getByRole("combobox", { name: "Project" })).toContainText(teams.alpha.project);
  await picker.getByRole("button", { name: "Save winner" }).click();
  await expect.poll(() => prisma.eventAwardWinner.count({ where: { award: { eventId } } })).toBe(1);

  const publish = async () => {
    await page.getByRole("button", { name: /^Publish results/ }).click();
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: /^Publish results$/ }).click();
    await expect.poll(async () => Boolean((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).resultsPublishedAt)).toBe(true);
  };
  const recipients = async () =>
    (await prisma.outboxMessage.findMany({ where: { kind: "results-published", payload: { path: ["eventId"], equals: eventId } }, select: { payload: true } })).map((row) => String((row.payload as Payload).to));
  await page.goto(`${dashboard()}?tab=judging&sub=judging-results`);
  await waitForHydration(page, "button");
  await publish();
  await expect.poll(async () => (await recipients()).sort()).toEqual([teams.alpha.leader.email, teams.beta.leader.email, solo.email].sort());
  await page.getByRole("button", { name: /^Unpublish/ }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: /^Unpublish$/ }).click();
  await expect.poll(async () => Boolean((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).resultsPublishedAt)).toBe(false);
  await publish();
  const again = await recipients();
  expect(new Set(again).size).toBe(again.length);

  // Disqualifying a winner after publication spells out the change to the live results page.
  await page.goto(`${dashboard()}?tab=judging&sub=judging-submissions`);
  await waitForHydration(page, "button");
  await page.getByRole("button", { name: `Actions for ${teams.alpha.project}` }).click();
  await page.getByRole("menuitem", { name: /^Disqualify/ }).click();
  const disqualify = page.getByRole("alertdialog");
  await expect(disqualify.getByText("The live results page will change")).toBeVisible();
  await expect(disqualify.getByText("Overall winner (1st place)").first()).toBeVisible();
  await expect(disqualify.getByText(/live results page changes straight away/)).toBeVisible();
  await disqualify.getByRole("button", { name: "Cancel" }).click();
  await expect(disqualify).toHaveCount(0);
  expect(await prisma.submission.count({ where: { eventId, status: "DISQUALIFIED" } })).toBe(0);
  // A project with no award: disqualify, then reinstating says lost awards don't come back.
  await page.getByRole("button", { name: `Actions for ${teams.beta.project}` }).click();
  await page.getByRole("menuitem", { name: /^Disqualify/ }).click();
  await expect(page.getByRole("alertdialog").getByText(/holds no award, so the live results page doesn't change/)).toBeVisible();
  await page.getByRole("alertdialog").getByLabel(/^Reason/).fill("Late entry");
  await page.getByRole("alertdialog").getByRole("button", { name: "Disqualify", exact: true }).click();
  await expect.poll(() => prisma.submission.count({ where: { eventId, status: "DISQUALIFIED" } })).toBe(1);
  await page.getByRole("button", { name: `Actions for ${teams.beta.project}` }).click();
  await page.getByRole("menuitem", { name: /^Reinstate/ }).click();
  const reinstate = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(reinstate.getByText(/Awards it lost when it was disqualified aren't given back/)).toBeVisible();
  await reinstate.getByRole("button", { name: "Reinstate", exact: true }).click();
  await expect.poll(() => prisma.submission.count({ where: { eventId, status: "DISQUALIFIED" } })).toBe(0);

  const anon = await newContext(browser);
  const results = await anon.newPage();
  await results.goto(`/${orgSlug}/${eventSlug}/results`);
  await expect(results.getByText("Overall winner")).toBeVisible();
  await expect(results.getByText(teams.alpha.project)).toBeVisible();
  const html = await results.content();
  for (const forbidden of ["80.0", "66.7", "Private note", teams.alpha.leader.email]) expect(html).not.toContain(forbidden);
  await anon.close();
  await discardQueuedTestEmail();
  await context.close();
});

test("on a phone the active tab and sub-tab are scrolled into view", async ({ browser }) => {
  const { context, page } = await userContext(browser, ownerEmail);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${dashboard()}?tab=judging&sub=judging-awards`);
  await waitForHydration(page, '[role="tab"]');
  const mainTab = page.getByRole("tablist", { name: "Manage event" }).getByRole("tab", { name: "Judging", exact: true });
  const subTab = page.getByRole("tablist", { name: "Judging sections" }).getByRole("tab", { name: /^Awards/ });
  await expect(mainTab).toHaveAttribute("aria-selected", "true");
  await expect(subTab).toHaveAttribute("aria-selected", "true");
  // Both rows overflow at this width, so the active tabs had to be scrolled to.
  expect(await page.getByRole("tablist", { name: "Manage event" }).evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await expect(mainTab).toBeInViewport({ ratio: 1 });
  await expect(subTab).toBeInViewport({ ratio: 1 });
  // The last main tab, deep-linked, is brought into view as well.
  await page.goto(`${dashboard()}?tab=settings`);
  await waitForHydration(page, '[role="tab"]');
  await expect(page.getByRole("tablist", { name: "Manage event" }).getByRole("tab", { name: "Settings", exact: true })).toBeInViewport({ ratio: 1 });
  await context.close();
});
