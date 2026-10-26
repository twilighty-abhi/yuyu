import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPageSectionType, EventPrivacyType, EventStatus, MembershipRole, PrismaClient, RsvpStatus } from "@prisma/client";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

// Event crew organiser smoke (docs/CREW.md). One serial story that drives the
// real dashboard as the organisation OWNER: add, validate, edit, reorder,
// show/hide, convert a registration, the People view, the sign-up link, the
// public Crew section, the crew ticket page, the check-in desk and removal.
// tests/e2e/crew.spec.ts covers the link page, link sign-up, capacity on the
// public card and section privacy; this spec does not repeat those.
test.describe.configure({ mode: "serial", timeout: 180_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const ownerEmail = `crew-smoke-owner-${suffix}@example.test`;
const password = "crew-smoke-password";
const orgSlug = `crew-smoke-${suffix}`;
const eventSlug = `crew-smoke-${suffix}`;
const eventTitle = `Crew Smoke ${suffix}`;

const asha = {
  name: "Asha Lead",
  email: `crew-asha-${suffix}@example.test`,
  food: "Vegetarian",
  role: "Logistics lead",
  bio: "Keeps the venue running.",
  linkedin: "https://www.linkedin.com/in/asha-lead",
};
// Step 4 renames Asha and changes her email; later steps use these.
const ashaEdited = { name: "Asha Lead-Rao", email: `crew-asha-new-${suffix}@example.test`, role: "Venue lead" };
const ben = { name: "Ben Helper", email: `crew-ben-${suffix}@example.test`, food: "vegetarian", role: "Volunteer" };
const cleo = { name: "Cleo Stage", email: `crew-cleo-${suffix}@example.test`, role: "Stage manager" };
// Seeded attendees: Grace is converted into crew (step 7); Nora stays an attendee.
const grace = { name: "Grace Guest", email: `crew-grace-${suffix}@example.test` };
const nora = { name: "Nora Normal", email: `crew-nora-${suffix}@example.test` };
const testEmails = [ownerEmail, asha.email, ashaEdited.email, ben.email, cleo.email, grace.email, nora.email, `crew-dup-${suffix}@example.test`];

let ownerId = "";
let organisationId = "";
let eventId = "";
let eventPageId = "";
let graceRsvp = { id: "", checkInToken: "" };
let noraRsvp = { id: "", checkInToken: "" };
let ipCounter = 10;

const dashboard = () => `/dashboard/${orgSlug}/event/${eventId}`;

/** Each context gets its own client address so per-IP rate limits never couple steps. */
async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.51.101.${ipCounter++}` });
  return context;
}

async function signIn(page: Page) {
  // A cold server compiles the auth routes on first use; warm them and allow retries.
  await page.request.get("/api/auth/csrf");
  await page.request.get("/api/auth/session");
  for (let attempt = 1; ; attempt++) {
    await page.goto("/login");
    const emailInput = page.getByRole("textbox", { name: /^Email/ });
    await hydrated(emailInput);
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
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

/** Waits for React to hydrate a control, so clicks and typing reach its handlers. */
async function hydrated(locator: Locator) {
  await expect.poll(() => locator.first().evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
}

/** Crew tickets queue real emails; drop them before any worker pass can send to test addresses. */
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

async function openCrewTab(page: Page) {
  await page.goto(`${dashboard()}?tab=guests&sub=crew`);
  await expect(page.getByRole("tab", { name: /^Crew/ })).toHaveAttribute("aria-selected", "true");
  const addButton = page.getByRole("button", { name: "Add crew member" });
  await hydrated(addButton);
  return addButton;
}

const crewList = (page: Page) => page.getByRole("list", { name: "Crew members" });
const crewRow = (page: Page, name: string) => crewList(page).getByRole("listitem").filter({ hasText: name });

async function crewRowNames(page: Page, names: string[]) {
  const texts = await crewList(page).getByRole("listitem").allTextContents();
  return texts.map((text) => names.find((name) => text.includes(name)) ?? "?");
}

type NewMember = { name: string; email: string; food?: string; role?: string; bio?: string; linkedin?: string; show?: boolean };

/** Opens Add crew member and fills the form; the caller submits. */
async function fillAddDialog(page: Page, member: NewMember) {
  await page.getByRole("button", { name: "Add crew member" }).click();
  const dialog = page.getByRole("dialog", { name: "Add crew member" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^Name/).fill(member.name);
  await dialog.getByLabel(/^Email/).fill(member.email);
  if (member.food) await dialog.getByLabel(/^Food preference/).fill(member.food);
  if (member.role) await dialog.getByLabel(/^Role/).fill(member.role);
  if (member.bio) await dialog.getByLabel(/^Short bio/).fill(member.bio);
  if (member.linkedin) await dialog.getByLabel(/^LinkedIn URL/).fill(member.linkedin);
  const show = dialog.getByRole("switch", { name: /^Show on event page/ });
  await expect(show).toBeChecked();
  if (member.show === false) {
    await show.click();
    await expect(show).not.toBeChecked();
  }
  return dialog;
}

async function addMember(page: Page, member: NewMember) {
  const dialog = await fillAddDialog(page, member);
  await dialog.getByRole("button", { name: "Add and send ticket" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${member.name} added to the crew` })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(crewRow(page, member.name)).toHaveCount(1);
}

const crewMemberByEmail = (email: string) =>
  prisma.eventCrewMember.findUnique({
    where: { eventId_email: { eventId, email } },
    select: { id: true, name: true, email: true, foodPreference: true, role: true, bio: true, linkedinUrl: true, showOnPage: true, joinedViaLink: true, sortOrder: true, rsvpId: true },
  });

test.beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: "Crew Smoke Owner", passwordHash: await bcrypt.hash(password, 12), emailVerified: new Date() },
  });
  ownerId = owner.id;
  const organisation = await prisma.organisation.create({
    data: { name: `Crew Smoke ${suffix}`, slug: orgSlug, memberships: { create: { userId: ownerId, role: MembershipRole.OWNER } } },
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
      capacity: 2,
      page: { create: { isPublished: true, aboutHtml: "<p>A meetup run by a crew.</p>" } },
    },
    include: { page: { select: { id: true } } },
  });
  eventId = event.id;
  eventPageId = event.page!.id;
  for (const [person, assign] of [
    [grace, (row: typeof graceRsvp) => { graceRsvp = row; }],
    [nora, (row: typeof noraRsvp) => { noraRsvp = row; }],
  ] as const) {
    assign(await prisma.rSVP.create({
      data: { eventId, attendeeKey: `guest:${person.email}`, guestEmail: person.email, guestName: person.name, status: RsvpStatus.CONFIRMED },
      select: { id: true, checkInToken: true },
    }));
  }
});

test.afterAll(async () => {
  await discardQueuedTestEmail();
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

test("1. an organiser adds a crew member who gets a crew ticket and its email", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await openCrewTab(page);
  await expect(page.getByText("No crew yet.")).toBeVisible();
  await addMember(page, asha);

  const row = crewRow(page, asha.name);
  await expect(row).toContainText(asha.role);
  await expect(row).toContainText(asha.email);
  await expect(row).toContainText(asha.food);
  await expect(row.getByText("Not checked in", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: `${asha.name} on LinkedIn (opens in a new tab)` })).toHaveAttribute("href", asha.linkedin);
  await expect(row.getByRole("switch")).toBeChecked();

  const member = await crewMemberByEmail(asha.email);
  expect(member).toMatchObject({ name: asha.name, foodPreference: asha.food, role: asha.role, bio: asha.bio, linkedinUrl: asha.linkedin, showOnPage: true, joinedViaLink: false, sortOrder: 0 });
  const rsvp = await prisma.rSVP.findUniqueOrThrow({ where: { id: member!.rsvpId }, select: { status: true, isCrew: true, teamId: true, guestName: true, guestEmail: true, checkInToken: true } });
  expect(rsvp).toMatchObject({ status: RsvpStatus.CONFIRMED, isCrew: true, teamId: null, guestName: asha.name, guestEmail: asha.email });
  // The ticket email is queued in the outbox (a running worker may already have picked it up).
  const queued = await prisma.outboxMessage.findMany({ where: { kind: "rsvp-confirmation", payload: { path: ["to"], equals: asha.email } }, select: { payload: true } });
  expect(queued).toHaveLength(1);
  expect((queued[0]!.payload as { checkInToken?: string }).checkInToken).toBe(rsvp.checkInToken);
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  await context.close();
});

test("2. food preferences are grouped case-insensitively for catering", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await openCrewTab(page);
  await addMember(page, ben);
  await addMember(page, cleo);
  await expect(crewRow(page, cleo.name)).toContainText("Food not given");

  const food = page.getByRole("list", { name: "Crew food preferences" }).getByRole("listitem");
  await expect(food).toHaveText(["Vegetarian 2", "Not given 1"]);
  await expect(page.getByText("For 3 crew members.", { exact: false })).toBeVisible();
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  await context.close();
});

test("3. the crew form refuses a duplicate email and a bare LinkedIn address", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await openCrewTab(page);

  // Emails are normalised, so a different case is still the same crew member.
  const dialog = await fillAddDialog(page, { name: "Ben Again", email: ben.email.toUpperCase() });
  await dialog.getByRole("button", { name: "Add and send ticket" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("This email is already on the crew.");
  await expect(dialog).toBeVisible();

  // The LinkedIn field is type="url": the browser blocks the submit, nothing reaches the server.
  await dialog.getByLabel(/^Email/).fill(`crew-dup-${suffix}@example.test`);
  const linkedin = dialog.getByLabel(/^LinkedIn URL/);
  await linkedin.fill("linkedin.com/in/x");
  await dialog.getByRole("button", { name: "Add and send ticket" }).click();
  expect(await linkedin.evaluate((node) => (node as HTMLInputElement).validity.typeMismatch)).toBe(true);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);

  expect(await prisma.eventCrewMember.count({ where: { eventId } })).toBe(3);
  expect(await prisma.rSVP.count({ where: { eventId, guestEmail: `crew-dup-${suffix}@example.test` } })).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("4. editing a crew member updates the row and keeps the ticket's name and email in step", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await openCrewTab(page);
  await crewRow(page, asha.name).getByRole("button", { name: `Edit ${asha.name}` }).click();
  const dialog = page.getByRole("dialog", { name: `Edit ${asha.name}` });
  await expect(dialog.getByLabel(/^Role/)).toHaveValue(asha.role);
  await dialog.getByLabel(/^Name/).fill(ashaEdited.name);
  await dialog.getByLabel(/^Email/).fill(ashaEdited.email);
  await dialog.getByLabel(/^Role/).fill(ashaEdited.role);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${ashaEdited.name} updated` })).toBeVisible();

  const row = crewRow(page, ashaEdited.name);
  await expect(row).toContainText(ashaEdited.role);
  await expect(row).toContainText(ashaEdited.email);
  await expect(row).not.toContainText(asha.role);

  expect(await crewMemberByEmail(asha.email)).toBeNull();
  const member = await crewMemberByEmail(ashaEdited.email);
  expect(member).toMatchObject({ name: ashaEdited.name, role: ashaEdited.role, foodPreference: asha.food });
  const rsvp = await prisma.rSVP.findUniqueOrThrow({ where: { id: member!.rsvpId }, select: { guestName: true, guestEmail: true, attendeeKey: true, isCrew: true } });
  expect(rsvp).toEqual({ guestName: ashaEdited.name, guestEmail: ashaEdited.email, attendeeKey: `guest:${ashaEdited.email}`, isCrew: true });
  expect(errors).toEqual([]);
  await context.close();
});

test("5. moving the last crew member up reorders the list", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await openCrewTab(page);
  const names = [ashaEdited.name, ben.name, cleo.name];
  expect(await crewRowNames(page, names)).toEqual([ashaEdited.name, ben.name, cleo.name]);
  await expect(crewRow(page, cleo.name).getByRole("button", { name: `Move ${cleo.name} down` })).toBeDisabled();

  await crewRow(page, cleo.name).getByRole("button", { name: `Move ${cleo.name} up` }).click();
  await expect.poll(() => crewRowNames(page, names)).toEqual([ashaEdited.name, cleo.name, ben.name]);

  const order = await prisma.eventCrewMember.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, select: { name: true, sortOrder: true } });
  expect(order).toEqual([
    { name: ashaEdited.name, sortOrder: 0 },
    { name: cleo.name, sortOrder: 1 },
    { name: ben.name, sortOrder: 2 },
  ]);
  // The order survives a reload.
  await page.reload();
  await expect.poll(() => crewRowNames(page, names)).toEqual([ashaEdited.name, cleo.name, ben.name]);
  expect(errors).toEqual([]);
  await context.close();
});

test("6. the row switch hides and shows a member on the event page", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await openCrewTab(page);
  const toggle = crewRow(page, ben.name).getByRole("switch", { name: "Show on event page" });
  await expect(toggle).toBeChecked();
  await hydrated(toggle);

  await toggle.click();
  await expect(page.getByRole("status").filter({ hasText: `${ben.name} is hidden on the event page` })).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => (await crewMemberByEmail(ben.email))?.showOnPage).toBe(false);

  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(page.getByRole("status").filter({ hasText: `${ben.name} is shown on the event page` })).toBeVisible();
  await expect(toggle).toBeChecked();
  await expect.poll(async () => (await crewMemberByEmail(ben.email))?.showOnPage).toBe(true);

  // Reviewing a whole crew is many quick changes; the dashboard budget must allow them.
  for (let flip = 0; flip < 12; flip += 1) {
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toBeChecked({ checked: flip % 2 === 1 });
  }
  await expect(page.getByText("Too many crew updates")).toHaveCount(0);
  await expect.poll(async () => (await crewMemberByEmail(ben.email))?.showOnPage).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test("7. adding a registered attendee converts their ticket, and Overview shows crew beside the places", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await openCrewTab(page);
  // Added hidden, so step 10 has a member that must not appear publicly.
  await addMember(page, { name: grace.name, email: grace.email, show: false });
  await expect(crewRow(page, grace.name).getByRole("switch")).not.toBeChecked();

  const member = await crewMemberByEmail(grace.email);
  expect(member).toMatchObject({ rsvpId: graceRsvp.id, showOnPage: false, joinedViaLink: false });
  const rsvp = await prisma.rSVP.findUniqueOrThrow({ where: { id: graceRsvp.id }, select: { checkInToken: true, isCrew: true, status: true } });
  expect(rsvp).toEqual({ checkInToken: graceRsvp.checkInToken, isCrew: true, status: RsvpStatus.CONFIRMED });
  expect(await prisma.rSVP.count({ where: { eventId, OR: [{ guestEmail: grace.email }, { attendeeKey: `guest:${grace.email}` }] } })).toBe(1);
  await discardQueuedTestEmail();

  // Places count attendees only (Nora); the 4 crew are named beside them, and all 5 are going.
  await page.goto(dashboard());
  const going = page.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^Going$/ }) }).first();
  await expect(going.locator("dd")).toContainText("1 / 2");
  await expect(going.locator("dd")).toContainText("+ 4 crew · 5 going");
  expect(errors).toEqual([]);
  await context.close();
});

test("8. Guests → People marks crew and offers no edit or remove for them", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await page.goto(`${dashboard()}?tab=guests&sub=people`);
  await hydrated(page.locator("#guest-search"));
  const guests = page.getByRole("list", { name: "Guests" });

  for (const name of [ashaEdited.name, grace.name]) {
    const row = guests.getByRole("listitem").filter({ hasText: name }).first();
    await expect(row.getByText("Crew", { exact: true })).toBeVisible();
    await hydrated(row.getByRole("button", { name: `More actions for ${name}` }));
    await row.getByRole("button", { name: `More actions for ${name}` }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Copy ticket link" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Remove RSVP" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: /registration/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }

  const noraRow = guests.getByRole("listitem").filter({ hasText: nora.name }).first();
  await expect(noraRow.getByText("Crew", { exact: true })).toHaveCount(0);
  await noraRow.getByRole("button", { name: `More actions for ${nora.name}` }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Edit registration or transfer ticket" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Remove RSVP" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
  await context.close();
});

test("9. the sign-up link is created, replaced and turned off", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await openCrewTab(page);
  const card = page.locator("section", { has: page.locator("#crew-link-title") });
  await expect(card.getByText("There is no sign-up link yet.")).toBeVisible();

  await card.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Crew sign-up link created" })).toBeVisible();
  const linkInput = card.getByRole("textbox", { name: "Sign-up link" });
  await expect(linkInput).toHaveValue(/\/crew\/[A-Za-z0-9_-]{43}$/);
  const first = (await prisma.eventCrewJoinLink.findUniqueOrThrow({ where: { eventId }, select: { token: true } })).token;
  await expect(linkInput).toHaveValue(new RegExp(`/crew/${first}$`));
  expect((await context.request.get(`/crew/${first}`)).status()).toBe(200);

  await card.getByRole("button", { name: "Replace link" }).click();
  const replace = page.getByRole("alertdialog", { name: "Replace the crew sign-up link?" });
  await replace.getByRole("button", { name: "Replace link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "New crew sign-up link created" })).toBeVisible();
  await expect.poll(async () => (await prisma.eventCrewJoinLink.findUnique({ where: { eventId }, select: { token: true } }))?.token).not.toBe(first);
  const second = (await prisma.eventCrewJoinLink.findUniqueOrThrow({ where: { eventId }, select: { token: true } })).token;
  await expect(linkInput).toHaveValue(new RegExp(`/crew/${second}$`));
  expect((await context.request.get(`/crew/${first}`)).status()).toBe(404);
  expect((await context.request.get(`/crew/${second}`)).status()).toBe(200);

  await card.getByRole("button", { name: "Turn off" }).click();
  const turnOff = page.getByRole("alertdialog", { name: "Turn off the crew sign-up link?" });
  await turnOff.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Crew sign-up link turned off" })).toBeVisible();
  await expect(linkInput).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Create link" })).toBeVisible();
  await expect.poll(() => prisma.eventCrewJoinLink.count({ where: { eventId } })).toBe(0);
  expect((await context.request.get(`/crew/${second}`)).status()).toBe(404);
  expect(errors).toEqual([]);
  await context.close();
});

test("10. switching on the Crew section publishes the shown members only", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await page.goto(`${dashboard()}?tab=page&sub=page`);
  const sections = page.locator("section", { has: page.locator("#event-page-sections-title") });
  const rows = sections.getByRole("listitem");
  await expect(rows.last()).toContainText("Crew");
  await expect(rows.last()).toContainText("3 crew shown");
  const crewSwitch = sections.getByRole("switch", { name: "Show Crew on the event page" });
  await expect(crewSwitch).not.toBeChecked();
  await hydrated(crewSwitch);

  await crewSwitch.click();
  await expect(crewSwitch).toBeChecked();
  const bar = page.getByRole("region", { name: "Unsaved changes" });
  await expect(bar).toContainText("1 unsaved change");
  await bar.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Event page saved" })).toBeVisible();
  await expect
    .poll(async () => (await prisma.eventPageSection.findUnique({ where: { pageId_type: { pageId: eventPageId, type: EventPageSectionType.CREW } }, select: { isVisible: true } }))?.isVisible)
    .toBe(true);

  const publicContext = await newContext(browser);
  const publicPage = await publicContext.newPage();
  publicPage.on("pageerror", (error) => errors.push(error.message));
  await publicPage.goto(`/${orgSlug}/${eventSlug}`);
  const section = publicPage.locator("section#crew");
  await expect(section.getByRole("heading", { level: 2, name: "Crew", exact: true })).toBeVisible();
  // The avatar repeats the name for screen readers, so match the visible card text.
  for (const name of [ashaEdited.name, cleo.name, ben.name]) {
    await expect(section.getByRole("paragraph").filter({ hasText: name })).toBeVisible();
  }
  await expect(section.getByText(ashaEdited.role, { exact: true })).toBeVisible();
  await expect(section.getByText(asha.bio, { exact: true })).toBeVisible();
  await expect(section).not.toContainText(grace.name);
  // Cards follow the organiser's order.
  const cards = await section.getByRole("listitem").allTextContents();
  expect(cards.map((text) => [ashaEdited.name, cleo.name, ben.name].find((name) => text.includes(name)))).toEqual([ashaEdited.name, cleo.name, ben.name]);
  await publicContext.close();
  expect(errors).toEqual([]);
  await context.close();
});

test("10b. Guests → Crew warns when shown crew are hidden by the section switch, and turns it on", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  await prisma.eventPageSection.updateMany({ where: { type: "CREW", page: { eventId } }, data: { isVisible: false } });
  await openCrewTab(page);
  const warning = page.getByRole("status").filter({ hasText: "The Crew section is off on your event page" });
  await expect(warning).toBeVisible();
  const turnOn = warning.getByRole("button", { name: "Turn on Crew section" });
  await hydrated(turnOn);
  await turnOn.click();
  await expect(page.getByRole("status").filter({ hasText: "The Crew section is on." })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await expect.poll(async () => (await prisma.eventPageSection.findFirst({ where: { type: "CREW", page: { eventId } } }))?.isVisible).toBe(true);
  await page.goto(`/${orgSlug}/${eventSlug}`);
  await expect(page.locator("section#crew")).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("11. a crew ticket shows the Crew chip and no cancel control", async ({ browser }) => {
  const member = await crewMemberByEmail(ashaEdited.email);
  const { checkInToken } = await prisma.rSVP.findUniqueOrThrow({ where: { id: member!.rsvpId }, select: { checkInToken: true } });
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`/ticket/${checkInToken}`);
  await expect(page.getByText(new RegExp(`You.re in, ${ashaEdited.name}!`))).toBeVisible();
  await expect(page.getByText("Crew", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cancel registration/ })).toHaveCount(0);

  // An ordinary attendee's ticket still offers it.
  await page.goto(`/ticket/${noraRsvp.checkInToken}`);
  await expect(page.getByRole("button", { name: /Cancel registration/ })).toBeVisible();
  await expect(page.getByText("Crew", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("12. the check-in desk shows the crew badge and food preference", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  const member = await crewMemberByEmail(ashaEdited.email);
  await page.goto(`${dashboard()}/check-in`);
  await expect(page.getByRole("heading", { name: "Check-in desk" })).toBeVisible();
  const search = page.getByRole("textbox", { name: "Name or email", exact: true });
  await hydrated(search);
  await search.fill(ashaEdited.name);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: ashaEdited.name }).getByRole("button", { name: "Check in", exact: true }).first().click();

  const confirm = page.getByRole("dialog", { name: "Confirm check-in" });
  await expect(confirm).toContainText(ashaEdited.name);
  await expect(confirm.getByText("Crew", { exact: true })).toBeVisible();
  await expect(confirm).toContainText("Crew food preference:");
  await expect(confirm).toContainText(asha.food);
  await confirm.getByRole("button", { name: "Confirm" }).click();

  const result = page.getByRole("status").filter({ hasText: "Event crew" });
  await expect(result).toContainText("Checked in");
  await expect(result).toContainText(ashaEdited.name);
  await expect(result).toContainText("Crew food preference:");
  await expect(result).toContainText(asha.food);
  await expect.poll(async () => (await prisma.rSVP.findUniqueOrThrow({ where: { id: member!.rsvpId }, select: { checkedInAt: true } })).checkedInAt !== null).toBe(true);

  await openCrewTab(page);
  await expect(crewRow(page, ashaEdited.name).getByText("Checked in", { exact: true })).toBeVisible();
  await expect(crewRow(page, ben.name).getByText("Not checked in", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("13. removing a crew member deletes their ticket and check-in", async ({ browser }) => {
  const { context, page, errors } = await ownerContext(browser);
  const member = await crewMemberByEmail(ashaEdited.email);
  await openCrewTab(page);
  await crewRow(page, ashaEdited.name).getByRole("button", { name: `Remove ${ashaEdited.name} from the crew` }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove from the crew?" });
  await expect(confirm).toContainText(ashaEdited.name);
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("status").filter({ hasText: `${ashaEdited.name} removed from the crew` })).toBeVisible();
  await expect(crewRow(page, ashaEdited.name)).toHaveCount(0);
  await expect(crewList(page).getByRole("listitem")).toHaveCount(3);

  expect(await prisma.eventCrewMember.findUnique({ where: { id: member!.id } })).toBeNull();
  expect(await prisma.rSVP.findUnique({ where: { id: member!.rsvpId } })).toBeNull();
  // The converted attendee and the ordinary one are untouched.
  expect(await prisma.rSVP.count({ where: { id: { in: [graceRsvp.id, noraRsvp.id] } } })).toBe(2);
  expect(errors).toEqual([]);
  await context.close();
});
