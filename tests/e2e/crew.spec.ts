import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPageSectionType, EventPrivacyType, EventStatus, MembershipRole, PrismaClient, RsvpStatus } from "@prisma/client";
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from "@playwright/test";

// Event crew journeys (docs/CREW.md). One ordered story: a crew member signs up
// through the private crew link, their ticket never takes an attendee place,
// they appear on the public page only once the Crew section is on and they are
// shown, and the organiser sees them (with their food preference) and the link
// in Guests → Crew. The generous timeout covers first-visit route compilation
// on a cold dev server.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const ownerEmail = `crew-owner-${suffix}@example.test`;
const password = "crew-journey-password";
const orgSlug = `crew-${suffix}`;
const eventSlug = `meetup-${suffix}`;
const eventTitle = `Crew Meetup ${suffix}`;
// Generated like generateCrewJoinToken (lib/core/crew.ts): 32 random bytes, base64url.
const crewToken = randomBytes(32).toString("base64url");
const crewPath = `/crew/${crewToken}`;
const crewMember = {
  name: "Casey Crew",
  email: `crew-member-${suffix}@example.test`,
  food: `Vegan ${suffix}`,
  role: `Registration desk ${suffix}`,
};
const attendee = { name: "Avery Attendee", email: `crew-attendee-${suffix}@example.test` };
const lateAttendee = { name: "Liam Late", email: `crew-late-${suffix}@example.test` };
const testEmails = [ownerEmail, crewMember.email, attendee.email, lateAttendee.email];

let ownerId = "";
let organisationId = "";
let eventId = "";
let eventPageId = "";
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

/** Crew and attendee tickets queue real emails; drop them before any worker pass can send to test addresses. */
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

/** The crew link is a private bearer link: no Referer, no index, no shared cache. */
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
  return body;
}

/** Registers an attendee through the endpoint the public form posts to, from its own client address. */
async function registerAttendee(browser: Browser, person: { name: string; email: string }) {
  const context = await newContext(browser);
  const response = await context.request.post("/api/rsvp", {
    data: { orgSlug, eventSlug, guestEmail: person.email, name: person.name, answers: {} },
  });
  const result = { status: response.status(), text: await response.text() };
  await context.close();
  return result;
}

test.beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: "Crew Owner", passwordHash: await bcrypt.hash(password, 12), emailVerified: new Date() },
  });
  ownerId = owner.id;
  const organisation = await prisma.organisation.create({
    data: { name: `Crew ${suffix}`, slug: orgSlug, memberships: { create: { userId: ownerId, role: MembershipRole.OWNER } } },
  });
  organisationId = organisation.id;
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const event = await prisma.event.create({
    data: {
      organisationId,
      title: eventTitle,
      slug: eventSlug,
      startDateTime: start,
      endDateTime: new Date(start.getTime() + 3 * 60 * 60 * 1000),
      timezone: "UTC",
      location: "Community Hall, 1 Test Street",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      capacity: 1,
      page: { create: { isPublished: true, aboutHtml: "<p>A small meetup run by a crew.</p>" } },
      crewJoinLink: { create: { token: crewToken } },
    },
    include: { page: { select: { id: true } } },
  });
  eventId = event.id;
  eventPageId = event.page!.id;
});

test.afterAll(async () => {
  await discardQueuedTestEmail();
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

test("the crew link is a private, unindexed page and unknown tokens 404", async ({ browser }) => {
  const context = await newContext(browser);
  const body = await expectCapabilityHeaders(await context.request.get(crewPath), "/crew/:token");
  expect(body).toContain(eventTitle);
  // Token-shaped but unknown, and malformed values, share the generic 404.
  const unknown = await context.request.get("/crew/not-a-real-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  expect(unknown.status()).toBe(404);
  expect(await unknown.text()).not.toContain(eventTitle);
  expect((await context.request.get("/crew/short")).status()).toBe(404);
  await context.close();
});

test("a crew member signs up through the link and starts hidden with a crew ticket", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await page.goto(crewPath);
  await expect(page.getByRole("heading", { level: 1, name: `Join the crew for ${eventTitle}` })).toBeVisible();
  await waitForHydration(page, 'input[autocomplete="name"]');
  await page.getByLabel(/^Name/).fill(crewMember.name);
  await page.getByLabel(/^Email/).fill(crewMember.email);
  // The food field has a suggestion list, so it is a combobox: address it by its label.
  await page.getByLabel(/^Food preference/).fill(crewMember.food);
  await page.getByLabel(/^Role/).fill(crewMember.role);
  await page.getByRole("button", { name: "Join the crew" }).click();
  await expect(page.getByRole("status").filter({ hasText: "your crew sign-up is in" })).toBeVisible();

  const member = await prisma.eventCrewMember.findFirstOrThrow({
    where: { eventId },
    select: { name: true, email: true, foodPreference: true, role: true, showOnPage: true, joinedViaLink: true, rsvp: { select: { status: true, isCrew: true, teamId: true } } },
  });
  expect(member).toEqual({
    name: crewMember.name,
    email: crewMember.email,
    foodPreference: crewMember.food,
    role: crewMember.role,
    showOnPage: false,
    joinedViaLink: true,
    rsvp: { status: RsvpStatus.CONFIRMED, isCrew: true, teamId: null },
  });
  expect(await prisma.eventCrewMember.count({ where: { eventId } })).toBe(1);
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  await context.close();
});

test("the crew ticket never takes the event's only attendee place", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  const joinCard = page.locator("section", { has: page.locator("#join-title") });

  // Crew count as going, but the single place is still free.
  await page.goto(`/${orgSlug}/${eventSlug}`);
  await expect(joinCard.getByText("1 going")).toBeVisible();
  await expect(joinCard.getByText("1 spot left")).toBeVisible();

  const first = await registerAttendee(browser, attendee);
  expect(first.status, first.text).toBe(200);
  await page.reload();
  await expect(joinCard.getByText("2 going")).toBeVisible();
  await expect(joinCard.getByText("0 spots left")).toBeVisible();

  // Now the place is taken: the next attendee waits.
  const second = await registerAttendee(browser, lateAttendee);
  expect(second.status, second.text).toBe(200);
  const statuses = await prisma.rSVP.findMany({ where: { eventId }, select: { guestEmail: true, status: true, isCrew: true }, orderBy: { createdAt: "asc" } });
  expect(statuses).toEqual([
    { guestEmail: crewMember.email, status: RsvpStatus.CONFIRMED, isCrew: true },
    { guestEmail: attendee.email, status: RsvpStatus.CONFIRMED, isCrew: false },
    { guestEmail: lateAttendee.email, status: RsvpStatus.WAITLISTED, isCrew: false },
  ]);
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  await context.close();
});

test("the public Crew section appears only when switched on, without email or food", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  const crewHeading = page.getByRole("heading", { level: 2, name: "Crew", exact: true });

  // No saved CREW section: nothing about the crew is published.
  await page.goto(`/${orgSlug}/${eventSlug}`);
  await expect(page.getByRole("heading", { level: 1, name: eventTitle })).toBeVisible();
  await expect(crewHeading).toHaveCount(0);
  await expect(page.getByText(crewMember.name)).toHaveCount(0);

  // Section on, but the member is still hidden (joined via the link): still no section.
  await prisma.eventPageSection.upsert({
    where: { pageId_type: { pageId: eventPageId, type: EventPageSectionType.CREW } },
    create: { pageId: eventPageId, type: EventPageSectionType.CREW, isVisible: true, sortOrder: 99 },
    update: { isVisible: true },
  });
  await page.reload();
  await expect(crewHeading).toHaveCount(0);

  // The organiser shows them: the card has name and role only.
  await prisma.eventCrewMember.updateMany({ where: { eventId }, data: { showOnPage: true } });
  await page.reload();
  await expect(crewHeading).toBeVisible();
  const section = page.locator("section#crew");
  // The avatar repeats the name for screen readers, so match the visible card text.
  await expect(section.getByRole("paragraph").filter({ hasText: crewMember.name })).toBeVisible();
  await expect(section.getByText(crewMember.role, { exact: true })).toBeVisible();

  // Neither the rendered page nor its raw HTML (including the RSC payload) carries private fields.
  const html = await page.content();
  expect(html).not.toContain(crewMember.email);
  expect(html).not.toContain(crewMember.food);
  const raw = await (await context.request.get(`/${orgSlug}/${eventSlug}`)).text();
  expect(raw).toContain(crewMember.name);
  expect(raw).not.toContain(crewMember.email);
  expect(raw).not.toContain(crewMember.food);
  expect(raw).not.toContain(crewToken);
  expect(errors).toEqual([]);
  await context.close();
});

test("the organiser sees the crew member, their food preference and the sign-up link in Guests → Crew", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}?tab=guests&sub=crew`);
  await expect(page.getByRole("tab", { name: /^Crew/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { level: 2, name: "Crew", exact: true })).toBeVisible();

  const row = page.getByRole("list", { name: "Crew members" }).getByRole("listitem").filter({ hasText: crewMember.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(crewMember.role);
  await expect(row).toContainText(crewMember.email);
  await expect(row).toContainText(crewMember.food);
  await expect(row.getByRole("switch")).toBeChecked();

  // Catering summary groups the crew's food preferences.
  await expect(page.getByRole("list", { name: "Crew food preferences" })).toContainText(crewMember.food);

  const linkCard = page.locator("section", { has: page.locator("#crew-link-title") });
  await expect(linkCard.getByRole("heading", { name: "Crew sign-up link" })).toBeVisible();
  const linkInput = linkCard.getByRole("textbox", { name: "Sign-up link" });
  await expect(linkInput).toHaveValue(new RegExp(`/crew/${crewToken}$`));
  await expect(linkCard.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(linkCard.getByRole("button", { name: "Replace link" })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
