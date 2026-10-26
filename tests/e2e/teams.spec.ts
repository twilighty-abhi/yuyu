import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPrivacyType, EventStatus, MembershipRole, PrismaClient, RegistrationMode, RsvpStatus, SoloPolicy } from "@prisma/client";
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Team registration journeys (docs/TEAMS.md). One ordered story: the organiser
// turns team mode on, a leader creates a team through the public form, a
// teammate joins through the join link, and an organiser approves a team on an
// approval-required event. The generous timeout covers first-visit route
// compilation on a cold dev server.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const ownerEmail = `teams-owner-${suffix}@example.test`;
const password = "teams-journey-password";
const orgSlug = `teams-${suffix}`;
const eventSlug = `hack-${suffix}`;
const eventTitle = `Team Hack ${suffix}`;
const approvalSlug = `jam-${suffix}`;
const approvalTitle = `Approval Jam ${suffix}`;
const teamName = `Night Owls ${suffix}`;
const approvalTeamName = `Early Birds ${suffix}`;
const leader = { name: "Lena Leader", email: `teams-leader-${suffix}@example.test` };
const member = { name: "Milo Member", email: `teams-member-${suffix}@example.test` };
const approvalLeader = { name: "Aria Approval", email: `teams-approval-leader-${suffix}@example.test` };
const approvalMember = { name: "Bram Approval", email: `teams-approval-member-${suffix}@example.test` };
const soloEntrant = { name: "Sol Solo", email: `teams-solo-${suffix}@example.test` };
const matchSlug = `match-${suffix}`;
const matchTitle = `Match Night ${suffix}`;
const matchLeader = { name: "Max Match", email: `teams-match-leader-${suffix}@example.test` };
const matchSeeker = { name: "Sasha Seeker", email: `teams-match-seeker-${suffix}@example.test` };
const declinedLeader = { name: "Dana Declined", email: `teams-declined-leader-${suffix}@example.test` };
const testEmails = [
  ownerEmail,
  leader.email,
  member.email,
  approvalLeader.email,
  approvalMember.email,
  soloEntrant.email,
  matchLeader.email,
  matchSeeker.email,
  declinedLeader.email,
];

let ownerId = "";
let organisationId = "";
let eventId = "";
let approvalEventId = "";
let manageToken = "";
let joinPath = "";
let ipCounter = 10;

/** Each context gets its own client address so per-IP rate limits never couple steps. */
async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.51.100.${ipCounter++}` });
  return context;
}

async function signIn(page: Page) {
  // A cold dev server compiles the auth routes on first use, which can fail
  // the first credentials round trip; warm them and allow a couple of retries.
  await page.request.get("/api/auth/csrf");
  await page.request.get("/api/auth/session");
  for (let attempt = 1; ; attempt++) {
    await page.goto("/login");
    // Typing before hydration leaves the controlled inputs' state empty.
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
  const page = await context.newPage();
  return { context, page };
}

/** Uncaught client errors fail the step that caused them. */
function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Waits for React to hydrate a control, so typing reaches controlled state. */
async function waitForHydration(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).first().evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
}

/** Registrations queue real emails; drop them before any worker pass can send to test addresses. */
async function discardQueuedTestEmail() {
  const messages = await prisma.outboxMessage.findMany({ select: { id: true, payload: true } });
  const ids = messages
    .filter((message) => {
      const to = (message.payload as { to?: unknown } | null)?.to;
      return typeof to === "string" && testEmails.includes(to);
    })
    .map((message) => message.id);
  if (ids.length) await prisma.outboxMessage.deleteMany({ where: { id: { in: ids } } });
}

/** The capability pages are private bearer links: no Referer, no index, no shared cache. */
async function expectCapabilityHeaders(response: APIResponse, label: string) {
  expect(response.status(), label).toBe(200);
  const headers = response.headers();
  expect(headers["referrer-policy"], label).toBe("no-referrer");
  // The production server (CI's `test:e2e:production`) sends the proxy's
  // capability-page value `private, no-cache, no-store, ...`; `next dev`
  // always sends its own `no-cache, must-revalidate`, so only require a
  // non-shareable value there.
  const cacheControl = headers["cache-control"] ?? "";
  if (process.env.PLAYWRIGHT_PRODUCTION_SERVER === "1") expect(cacheControl, label).toContain("no-store");
  else expect(cacheControl, label).toMatch(/no-store|no-cache/);
  expect(cacheControl, label).not.toMatch(/public|s-maxage/);
  const body = await response.text();
  expect(body, label).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/);
  expect(body, label).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/);
}

async function createTeamEvent(data: { slug: string; title: string; privacyType: EventPrivacyType }) {
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return prisma.event.create({
    data: {
      organisationId,
      title: data.title,
      slug: data.slug,
      startDateTime: start,
      endDateTime: new Date(start.getTime() + 8 * 60 * 60 * 1000),
      timezone: "UTC",
      location: "Makerspace, 2 Test Street",
      status: EventStatus.PUBLISHED,
      privacyType: data.privacyType,
      page: { create: { isPublished: true, aboutHtml: "<p>Build something in a day.</p>" } },
    },
  });
}

test.beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: "Teams Owner", passwordHash: await bcrypt.hash(password, 12), emailVerified: new Date() },
  });
  ownerId = owner.id;
  const organisation = await prisma.organisation.create({
    data: { name: `Teams ${suffix}`, slug: orgSlug, memberships: { create: { userId: ownerId, role: MembershipRole.OWNER } } },
  });
  organisationId = organisation.id;
  eventId = (await createTeamEvent({ slug: eventSlug, title: eventTitle, privacyType: EventPrivacyType.PUBLIC })).id;
});

test.afterAll(async () => {
  await discardQueuedTestEmail();
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

test("an organiser turns on team registration in the event's publishing settings", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}?tab=page`);
  const form = page.getByRole("form", { name: "Event details" });
  await expect(form).toBeVisible();
  const teamSwitch = form.getByRole("switch", { name: /^Team registration/ });
  await waitForHydration(page, 'form[aria-label="Event details"] [role="switch"]');
  await expect(teamSwitch).not.toBeChecked();
  await teamSwitch.click();
  await expect(teamSwitch).toBeChecked();
  await form.getByRole("spinbutton", { name: "Smallest team" }).fill("2");
  await form.getByRole("spinbutton", { name: "Largest team" }).fill("3");
  // The solo-policy dropdown is named by its question (not by the hidden native select).
  await expect(form.getByRole("combobox", { name: "Can people sign up without a team?" })).toHaveText("Teams or on their own");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Event saved").first()).toBeVisible();
  await expect
    .poll(async () => prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { registrationMode: true, teamMinSize: true, teamMaxSize: true } }))
    .toEqual({ registrationMode: RegistrationMode.TEAM, teamMinSize: 2, teamMaxSize: 3 });
  expect(errors).toEqual([]);
  await context.close();
});

test("a leader creates a team through the public form and sees the confirmation", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await page.goto(`/${orgSlug}/${eventSlug}`);
  const joinCard = page.locator("section", { has: page.locator("#join-title") });
  await expect(joinCard.getByText("0 places taken")).toBeVisible();
  await page.getByRole("button", { name: /^Register/ }).first().click();
  const dialog = page.getByRole("dialog", { name: `Register for ${eventTitle}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Create a team/ })).toBeChecked();
  // Keyboard: the arrow keys move through the options without focus leaving the group,
  // including through "Join with a link", which hides the rest of the form.
  await waitForHydration(page, '[role="dialog"] [role="radio"]');
  await dialog.getByRole("radio", { name: /Create a team/ }).focus();
  // Radix moves focus a tick after keydown and checks the option only while the
  // key is still down, so hold each key briefly as a person does.
  const pressArrow = async (key: "ArrowDown" | "ArrowUp") => {
    await page.keyboard.down(key);
    await page.waitForTimeout(100);
    await page.keyboard.up(key);
  };
  await pressArrow("ArrowDown");
  await expect(dialog.getByRole("radio", { name: /Join with a link/ })).toBeFocused();
  await expect(dialog.getByRole("radio", { name: /Join with a link/ })).toBeChecked();
  // The note says what the link does, with the callout's own icon only.
  const linkNote = dialog.locator("div.rounded-lg", { hasText: "Ask your team leader for the team link" }).last();
  await expect(linkNote).toContainText("The link opens a page for that team where you register straight into it.");
  await expect(linkNote).not.toContainText("brings you back");
  await expect(linkNote.locator("svg")).toHaveCount(1);
  await pressArrow("ArrowUp");
  await expect(dialog.getByRole("radio", { name: /Create a team/ })).toBeFocused();
  await expect(dialog.getByRole("radio", { name: /Create a team/ })).toBeChecked();
  await dialog.getByRole("textbox", { name: /^Team name/ }).fill(teamName);
  await dialog.getByRole("textbox", { name: /^Name/ }).fill(leader.name);
  await dialog.getByRole("textbox", { name: /^Email/ }).fill(leader.email);
  await dialog.getByRole("button", { name: "Register", exact: true }).click();
  // A new leader's dialog stays open on the done message: the team page link is emailed.
  await expect(dialog.getByText(/Your team is registered\. Check your email for your team page link/)).toBeVisible();
  // The places count behind the dialog updates without a reload.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(joinCard.getByText("1 place taken")).toBeVisible();

  const team = await prisma.team.findFirstOrThrow({ where: { eventId }, include: { members: true } });
  expect(team.name).toBe(teamName);
  expect(team.status).toBe("CONFIRMED");
  expect(team.members.map((rsvp) => rsvp.guestEmail)).toEqual([leader.email]);
  expect(team.leaderRsvpId).toBe(team.members[0]!.id);

  // The raw management token exists only in the queued team-created email.
  const created = await prisma.outboxMessage.findMany({ where: { kind: "team-created" }, select: { payload: true } });
  const payload = created.map((message) => message.payload as { to?: string; teamId?: string; manageToken?: string }).find((item) => item.teamId === team.id);
  expect(payload?.to).toBe(leader.email);
  manageToken = payload!.manageToken!;
  expect(manageToken).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  await context.close();
});

test("the team page shows the join link and is a private, unindexed page", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await expectCapabilityHeaders(await page.request.get(`/team/${manageToken}`), "/team/:token");

  await page.goto(`/team/${manageToken}`);
  // The page sits in Yuyu's site chrome: header, a main landmark (skip-link target) and the page gutter.
  const main = page.locator("main#main-content");
  await expect(main).toBeVisible();
  const joinCard = main.locator("section", { has: page.locator("#team-join-link") });
  await expect(joinCard).toBeVisible();
  const joinUrl = (await joinCard.locator(".font-mono").innerText()).trim();
  joinPath = new URL(joinUrl, "http://placeholder.invalid").pathname;
  expect(joinPath).toMatch(new RegExp(`^/${orgSlug}/${eventSlug}/team/[A-Za-z0-9_-]{32,128}$`));
  await expect(page.getByRole("list").filter({ hasText: leader.name }).first()).toBeVisible();
  // A confirmed team below the minimum on an event without approval is told to grow, not that approval waits.
  await expect(main.getByText("Teams need at least 2 members. Add 1 more with the join link so your team is complete.")).toBeVisible();
  await expect(main.getByText(/can't approve your team/)).toHaveCount(0);

  // An unknown management token reveals nothing.
  expect((await page.request.get(`/team/${"x".repeat(43)}`)).status()).toBe(404);
  expect(errors).toEqual([]);
  await context.close();
});

test("a second person joins the team through the join link", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await expectCapabilityHeaders(await page.request.get(joinPath), "join page");

  await page.goto(joinPath);
  await expect(page.getByRole("heading", { level: 2, name: `Join ${teamName}` })).toBeVisible();
  // The join page shows the team's name and size, never its members.
  await expect(page.getByText("1 of 3 members")).toBeVisible();
  await expect(page.getByText(leader.name)).toHaveCount(0);
  await waitForHydration(page, 'input[name="name"], input[autocomplete="name"]');
  await page.getByRole("textbox", { name: /^Name/ }).fill(member.name);
  await page.getByRole("textbox", { name: /^Email/ }).fill(member.email);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByText(`You’re on ${teamName}.`, { exact: false })).toBeVisible();

  const rsvps = await prisma.rSVP.findMany({ where: { eventId }, select: { guestEmail: true, status: true, team: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
  expect(rsvps).toEqual([
    { guestEmail: leader.email, status: "CONFIRMED", team: { name: teamName } },
    { guestEmail: member.email, status: "CONFIRMED", team: { name: teamName } },
  ]);
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  await context.close();
});

test("the join link 404s for hidden, invite-only and unreleased events", async ({ browser }) => {
  const context = await newContext(browser);
  const cases: Array<{ label: string; status?: EventStatus; privacyType?: EventPrivacyType; released?: boolean }> = [
    { label: "hidden", status: EventStatus.HIDDEN },
    { label: "draft", status: EventStatus.DRAFT },
    { label: "invite-only", privacyType: EventPrivacyType.INVITE_ONLY },
    { label: "unreleased website", released: false },
  ];
  try {
    for (const item of cases) {
      await prisma.event.update({
        where: { id: eventId },
        data: { status: item.status ?? EventStatus.PUBLISHED, privacyType: item.privacyType ?? EventPrivacyType.PUBLIC },
      });
      await prisma.eventPage.update({ where: { eventId }, data: { isPublished: item.released ?? true } });
      const response = await context.request.get(joinPath);
      expect(response.status(), item.label).toBe(404);
      expect(await response.text(), item.label).not.toContain(teamName);
    }
  } finally {
    await prisma.event.update({ where: { id: eventId }, data: { status: EventStatus.PUBLISHED, privacyType: EventPrivacyType.PUBLIC } });
    await prisma.eventPage.update({ where: { eventId }, data: { isPublished: true } });
  }
  // Released again, the same link works; a retired or unknown token never does.
  expect((await context.request.get(joinPath)).status()).toBe(200);
  expect((await context.request.get(`/${orgSlug}/${eventSlug}/team/${"y".repeat(43)}`)).status()).toBe(404);
  await context.close();
});

test("a solo registrant joins the team by pasting its link on their ticket page", async ({ browser }) => {
  const context = await newContext(browser);
  const created = await context.request.post("/api/rsvp", {
    data: { orgSlug, eventSlug, guestEmail: soloEntrant.email, name: soloEntrant.name, answers: {}, team: { mode: "solo" } },
  });
  expect(created.status(), await created.text()).toBe(200);
  await discardQueuedTestEmail();
  const solo = await prisma.rSVP.findFirstOrThrow({ where: { eventId, guestEmail: soloEntrant.email }, select: { id: true, teamId: true, checkInToken: true } });
  expect(solo.teamId).toBeNull();

  const page = await context.newPage();
  const errors = collectPageErrors(page);
  // The ticket page (with Join a team and the seeker list) is a bearer page like /team/:token.
  await expectCapabilityHeaders(await page.request.get(`/ticket/${solo.checkInToken}`), "/ticket/:token");
  await page.goto(`/ticket/${solo.checkInToken}`);
  const card = page.locator("section", { has: page.locator("#ticket-join-team-title") });
  await expect(card).toBeVisible();
  await waitForHydration(page, 'section:has(#ticket-join-team-title) input');
  // A management link is not a join link and is refused.
  await card.getByRole("textbox", { name: /^Team link/ }).fill(`https://yuyu.example/team/${manageToken}`);
  await card.getByRole("button", { name: "Join this team" }).click();
  await expect(card.getByText(/Paste the full team link/)).toBeVisible();
  // The join link, pasted without its scheme, moves this registration in.
  await card.getByRole("textbox", { name: /^Team link/ }).fill(`yuyu.example${joinPath}`);
  await card.getByRole("button", { name: "Join this team" }).click();
  await expect(page.getByRole("heading", { level: 2, name: teamName })).toBeVisible();

  const moved = await prisma.rSVP.findUniqueOrThrow({ where: { id: solo.id }, select: { status: true, checkInToken: true, team: { select: { name: true } } } });
  expect(moved).toEqual({ status: "CONFIRMED", checkInToken: solo.checkInToken, team: { name: teamName } });
  expect(await prisma.rSVP.count({ where: { eventId } })).toBe(3);
  // The team is now full (3 of 3): the join page says so and doesn't promise a form.
  const fullJoin = await context.newPage();
  await fullJoin.goto(joinPath);
  await expect(fullJoin.getByText("This team is full")).toBeVisible();
  await expect(fullJoin.getByText(/Register below/)).toHaveCount(0);
  await fullJoin.close();
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  await context.close();
});

test("an organiser approves a team on an approval-required event and both tickets show it", async ({ browser }) => {
  const approvalEvent = await createTeamEvent({ slug: approvalSlug, title: approvalTitle, privacyType: EventPrivacyType.APPROVAL_REQUIRED });
  approvalEventId = approvalEvent.id;
  await prisma.event.update({ where: { id: approvalEventId }, data: { registrationMode: RegistrationMode.TEAM, teamMaxSize: 4 } });

  // Both people register through the same endpoint the public form posts to.
  const leaderContext = await newContext(browser);
  const created = await leaderContext.request.post("/api/rsvp", {
    data: { orgSlug, eventSlug: approvalSlug, guestEmail: approvalLeader.email, name: approvalLeader.name, answers: {}, team: { mode: "create", name: approvalTeamName } },
  });
  expect(created.status(), await created.text()).toBe(200);
  const team = await prisma.team.findFirstOrThrow({ where: { eventId: approvalEventId } });
  expect(team.status).toBe("PENDING_APPROVAL");
  const memberContext = await newContext(browser);
  const joined = await memberContext.request.post("/api/rsvp", {
    data: { orgSlug, eventSlug: approvalSlug, guestEmail: approvalMember.email, name: approvalMember.name, answers: {}, team: { mode: "join", joinToken: team.joinToken } },
  });
  expect(joined.status(), await joined.text()).toBe(200);
  await discardQueuedTestEmail();

  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  // Below the minimum, Approve stays reachable by keyboard and explains itself in visible text.
  await prisma.event.update({ where: { id: approvalEventId }, data: { teamMinSize: 3 } });
  await page.goto(`/dashboard/${orgSlug}/event/${approvalEventId}?tab=guests`);
  await page.getByRole("tab", { name: /^Teams/ }).click();
  const teams = page.getByRole("list", { name: "Teams" });
  await expect(teams.getByText(approvalTeamName)).toBeVisible();
  const approve = teams.getByRole("button", { name: `Approve team ${approvalTeamName}` });
  await expect(approve).toHaveAttribute("aria-disabled", "true");
  await expect(approve).not.toHaveAttribute("title");
  await expect(approve).toHaveAccessibleDescription("Can't be approved yet: this team needs at least 3 people.");
  await expect(teams.getByText("Can't be approved yet: this team needs at least 3 people.")).toBeVisible();
  await approve.focus();
  await expect(approve).toBeFocused();
  await page.keyboard.press("Enter");
  expect((await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).status).toBe("PENDING_APPROVAL");

  await prisma.event.update({ where: { id: approvalEventId }, data: { teamMinSize: null } });
  await page.reload();
  await page.getByRole("tab", { name: /^Teams/ }).click();
  await expect(teams.getByText(approvalTeamName)).toBeVisible();
  await expect(approve).not.toHaveAttribute("aria-disabled");
  await approve.click();
  await expect
    .poll(async () => (await prisma.rSVP.findMany({ where: { eventId: approvalEventId }, select: { status: true } })).map((rsvp) => rsvp.status))
    .toEqual(["CONFIRMED", "CONFIRMED"]);
  expect((await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).status).toBe("CONFIRMED");
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  await context.close();

  const tickets = await prisma.rSVP.findMany({ where: { eventId: approvalEventId }, select: { checkInToken: true, guestName: true } });
  for (const ticket of tickets) {
    const ticketPage = await memberContext.newPage();
    await ticketPage.goto(`/ticket/${ticket.checkInToken}`);
    const card = ticketPage.locator("section", { has: ticketPage.locator("#ticket-team-title") });
    await expect(card.getByRole("heading", { level: 2, name: approvalTeamName }), ticket.guestName ?? "").toBeVisible();
    await expect(card.getByText(/^Led by /)).toBeVisible();
    const members = card.getByRole("list", { name: "Team members" }).getByRole("listitem");
    await expect(members).toHaveCount(2);
    await ticketPage.close();
  }
  await leaderContext.close();
  await memberContext.close();
});

test("the check-in desk lookup says it matches teams and finds a team's members", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}/check-in`);
  const search = page.getByRole("textbox", { name: "Name, email or team", exact: true });
  await expect(search).toHaveAttribute("placeholder", "Name, email or team");
  await waitForHydration(page, "#check-in-search");
  await search.fill(teamName);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("button", { name: leader.name }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: member.name }).first()).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("the create event dialog explains a too-small team size inline and focuses the field", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/${orgSlug}`);
  await page.getByRole("button", { name: "New event" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Create Event: Basics" })).toBeVisible();
  await dialog.getByRole("textbox", { name: /^Title/ }).fill(`Too Small ${suffix}`);
  await dialog.getByRole("textbox", { name: "About the event" }).fill("Checks the team size message.");
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("heading", { name: "Create Event: Schedule" })).toBeVisible();
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("heading", { name: "Create Event: Location" })).toBeVisible();
  await dialog.getByRole("textbox", { name: /^Location/ }).fill("Community Hall, 1 Test Street");
  await dialog.getByRole("switch", { name: /^Team registration/ }).click();
  const largest = dialog.getByRole("spinbutton", { name: "Largest team" });
  await largest.fill("1");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  const message = "Teams need room for at least 2 people.";
  await expect(dialog.getByText(message)).toBeVisible();
  await expect(dialog.getByText(message)).toHaveAttribute("aria-live", "polite");
  await expect(largest).toBeFocused();
  await expect(largest).toHaveAttribute("aria-invalid", "true");
  await expect(largest).toHaveAccessibleDescription(message);
  // No native constraint competes with the inline message (no browser bubble).
  expect(await largest.evaluate((node: HTMLInputElement) => node.validity.valid)).toBe(true);
  // Only the inline message: no second copy in the dialog's alert.
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(await prisma.event.count({ where: { organisationId, title: `Too Small ${suffix}` } })).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("a leader's team page lists invited seekers accurately and a declined team offers no management actions", async ({ browser }) => {
  const matchEvent = await createTeamEvent({ slug: matchSlug, title: matchTitle, privacyType: EventPrivacyType.PUBLIC });
  await prisma.event.update({ where: { id: matchEvent.id }, data: { registrationMode: RegistrationMode.TEAM, teamMaxSize: 4, soloPolicy: SoloPolicy.SOLO_WITH_MATCHING } });
  // One client address per registration, so the per-IP registration limit never couples them.
  const register = async (data: Record<string, unknown>) => {
    const registrant = await newContext(browser);
    const response = await registrant.request.post("/api/rsvp", { data });
    const result = { status: response.status(), text: await response.text() };
    await registrant.close();
    return result;
  };
  const created = await register({ orgSlug, eventSlug: matchSlug, guestEmail: matchLeader.email, name: matchLeader.name, answers: {}, team: { mode: "create", name: `Match Team ${suffix}` } });
  expect(created.status, created.text).toBe(200);
  const seeker = await register({
    orgSlug,
    eventSlug: matchSlug,
    guestEmail: matchSeeker.email,
    name: matchSeeker.name,
    answers: {},
    team: { mode: "solo", seeker: { headline: "Frontend developer", skills: ["React"] } },
  });
  expect(seeker.status, seeker.text).toBe(200);
  const declined = await register({ orgSlug, eventSlug: matchSlug, guestEmail: declinedLeader.email, name: declinedLeader.name, answers: {}, team: { mode: "create", name: `Declined Team ${suffix}` } });
  expect(declined.status, declined.text).toBe(200);
  const tokenFor = async (teamName: string) => {
    const team = await prisma.team.findFirstOrThrow({ where: { eventId: matchEvent.id, name: teamName } });
    const messages = await prisma.outboxMessage.findMany({ where: { kind: "team-created" }, select: { payload: true } });
    const payload = messages.map((message) => message.payload as { teamId?: string; manageToken?: string }).find((item) => item.teamId === team.id);
    return { team, manageToken: payload!.manageToken! };
  };
  const match = await tokenFor(`Match Team ${suffix}`);
  const rejected = await tokenFor(`Declined Team ${suffix}`);
  await discardQueuedTestEmail();

  const context = await newContext(browser);
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await page.goto(`/team/${match.manageToken}`);
  const matching = page.locator("section", { has: page.locator("#team-matching") });
  await expect(matching.locator("p", { hasText: "Sasha S." }).first()).toBeVisible();
  await waitForHydration(page, "section:has(#team-matching) button");
  // Each Invite button names the person it invites.
  await matching.getByRole("button", { name: "Invite Sasha S.", exact: true }).click();
  await expect(matching.getByRole("heading", { name: "Invitations you sent" })).toBeVisible();
  await expect(matching.getByText("Everyone looking for a team has already been invited. Check back later.")).toBeVisible();
  await expect(matching.getByText("No one is looking for a team yet")).toHaveCount(0);

  // A declined team: viewing and disbanding stay; rename and link resets are gone.
  await prisma.$transaction([
    prisma.team.update({ where: { id: rejected.team.id }, data: { status: RsvpStatus.REJECTED } }),
    prisma.rSVP.updateMany({ where: { teamId: rejected.team.id }, data: { status: RsvpStatus.REJECTED } }),
  ]);
  await page.goto(`/team/${rejected.manageToken}`);
  const main = page.locator("main#main-content");
  await expect(main.getByText(/The organisers declined this team/)).toBeVisible();
  await expect(main.getByRole("heading", { level: 1, name: `Declined Team ${suffix}` })).toBeVisible();
  await expect(main.getByRole("button", { name: "Rename" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /Reset management link/ })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /Create a new link/ })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Disband team…" })).toBeVisible();
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  await context.close();
});

test("dashboards show team units against capacity and people separately; individual events are unchanged", async ({ browser }) => {
  // Three confirmed teams of two fill a capacity of 3 units with 6 people.
  const unitsEvent = await createTeamEvent({ slug: `units-${suffix}`, title: `Units Night ${suffix}`, privacyType: EventPrivacyType.PUBLIC });
  await prisma.event.update({ where: { id: unitsEvent.id }, data: { registrationMode: RegistrationMode.TEAM, teamMaxSize: 4, capacity: 3 } });
  for (const index of [1, 2, 3]) {
    const name = `Units Team ${index} ${suffix}`;
    const team = await prisma.team.create({
      data: { eventId: unitsEvent.id, name, nameKey: name.toLowerCase(), status: RsvpStatus.CONFIRMED, joinToken: `units-join-${index}-${suffix}`, manageTokenHash: `units-manage-${index}-${suffix}` },
    });
    for (const person of ["a", "b"]) {
      const email = `units-${index}${person}-${suffix}@example.test`;
      await prisma.rSVP.create({ data: { eventId: unitsEvent.id, guestEmail: email, guestName: `Units ${index}${person}`, attendeeKey: `guest:${email}`, status: RsvpStatus.CONFIRMED, teamId: team.id } });
    }
  }
  // An individual event keeps the plain "Going" people count.
  const individualSlug = `solo-night-${suffix}`;
  const individual = await createTeamEvent({ slug: individualSlug, title: `Solo Night ${suffix}`, privacyType: EventPrivacyType.PUBLIC });
  await prisma.event.update({ where: { id: individual.id }, data: { capacity: 5 } });
  for (const person of ["x", "y"]) {
    const email = `units-ind-${person}-${suffix}@example.test`;
    await prisma.rSVP.create({ data: { eventId: individual.id, guestEmail: email, guestName: `Ind ${person}`, attendeeKey: `guest:${email}`, status: RsvpStatus.CONFIRMED } });
  }

  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  const headerStat = (label: string) => page.locator("header dl > div:visible", { has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) });

  await page.goto(`/dashboard/${orgSlug}/event/${unitsEvent.id}`);
  const places = headerStat("Places taken");
  await expect(places.locator("dd")).toContainText("3 / 3");
  await expect(places.locator("dd")).toContainText("teams & solo places · 6 people going");
  await expect(headerStat("Going")).toHaveCount(0);
  await expect(page.locator("header dl:visible").first()).not.toContainText("6 / 3");

  await page.goto(`/dashboard/${orgSlug}/event/${unitsEvent.id}?tab=analytics`);
  await expect(page.getByText("3 / 3 teams & solo places · full").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(/places left/)).toHaveCount(0);

  // The organisation event list chip compares units with capacity.
  await page.goto(`/dashboard/${orgSlug}`);
  await expect(page.getByRole("link", { name: new RegExp(`Units Night ${suffix}`) }).filter({ hasText: "Full", visible: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Solo Night ${suffix}`) }).filter({ hasText: "2 / 5 going", visible: true }).first()).toBeVisible();

  await page.goto(`/dashboard/${orgSlug}/event/${individual.id}`);
  await expect(headerStat("Going").locator("dd")).toContainText("2 / 5");
  await expect(headerStat("Places taken")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();

  // The public card already counts units: full, with no places left.
  const visitor = await newContext(browser);
  const publicPage = await visitor.newPage();
  await publicPage.goto(`/${orgSlug}/units-${suffix}`);
  const joinCard = publicPage.locator("section", { has: publicPage.locator("#join-title") });
  await expect(joinCard.getByText("3 places taken")).toBeVisible();
  await expect(joinCard.getByText("0 places left")).toBeVisible();
  await visitor.close();
});
