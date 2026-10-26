import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPrivacyType, EventStatus, PrismaClient } from "@prisma/client";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { zonedInputToIso } from "../../lib/timeZone";

// End-to-end journeys through the redesigned (V1) organiser and attendee UI.
// The file is one ordered story: later steps rely on the organisation, event,
// and registrations created by earlier ones.
// The generous timeout covers first-visit route compilation on a cold dev server.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const ownerEmail = `redesign-owner-${suffix}@example.test`;
const password = "redesign-journey-password";
const orgName = `Redesign Journeys ${suffix}`;
const orgSlug = `redesign-${suffix}`;
const eventTitle = `Redesign Meetup ${suffix}`;
const firstGuest = { name: "Asha Confirmed", email: `redesign-guest-a-${suffix}@example.test` };
const secondGuest = { name: "Ravi Waitlisted", email: `redesign-guest-b-${suffix}@example.test` };
const testEmails = [ownerEmail, firstGuest.email, secondGuest.email];

let ownerId = "";
let eventId = "";
let eventSlug = "";
let firstTicketPath = "";
let ipCounter = 10;

/** Each context gets its own client address so per-IP rate limits never couple steps. */
async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `192.0.2.${ipCounter++}` });
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
async function ownerContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  if (!ownerSession) {
    const signInContext = await newContext(browser);
    await signIn(await signInContext.newPage());
    ownerSession = await signInContext.storageState();
    await signInContext.close();
  }
  const context = await newContext(browser, { ...options, storageState: ownerSession });
  const page = await context.newPage();
  return { context, page };
}

/** Uncaught client errors fail the step that caused them. */
function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoErrorScreen(page: Page) {
  await expect(page.getByText(/Application error|Unhandled Runtime Error|Something went wrong/i)).toHaveCount(0);
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** UI registrations queue real confirmation emails; drop them before any worker pass can send to test addresses. */
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

async function register(context: BrowserContext, guest: { name: string; email: string }, buttonName: string | RegExp) {
  const page = await context.newPage();
  const errors = collectPageErrors(page);
  await page.goto(`/${orgSlug}/${eventSlug}`);
  await page.getByRole("button", { name: buttonName }).first().click();
  // A full event's dialog says it is the waitlist, not a ticket.
  const waitlist = buttonName === "Join the waitlist";
  const dialog = page.getByRole("dialog", { name: waitlist ? `Join the waitlist for ${eventTitle}` : `Register for ${eventTitle}` });
  await expect(dialog).toBeVisible();
  if (waitlist) await expect(dialog).toContainText("This event is full.");
  await dialog.getByRole("textbox", { name: /^Name/ }).fill(guest.name);
  await dialog.getByRole("textbox", { name: /^Email/ }).fill(guest.email);
  await dialog.getByRole("button", { name: "Register", exact: true }).click();
  await expect(dialog).toBeHidden();
  await discardQueuedTestEmail();
  expect(errors).toEqual([]);
  return page;
}

test.beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: "Redesign Owner", passwordHash: await bcrypt.hash(password, 12), emailVerified: new Date() },
  });
  ownerId = owner.id;
});

test.afterAll(async () => {
  await discardQueuedTestEmail();
  await prisma.organisation.deleteMany({ where: { slug: orgSlug } });
  if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
  await prisma.$disconnect();
});

test("an organiser creates an organisation from the dashboard", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto("/dashboard/org/new");
  await page.getByRole("textbox", { name: /^Name/ }).fill(orgName);
  await page.getByRole("textbox", { name: /^Web address/ }).fill(orgSlug);
  await expect(page.getByText("URL slug is available!")).toBeVisible();
  await page.getByRole("button", { name: "Create organisation" }).click();
  await page.waitForURL(`**/${orgSlug}`);

  await page.goto(`/dashboard/${orgSlug}`);
  await expect(page.getByRole("heading", { level: 1, name: orgName })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Organisation" }).getByRole("link", { name: "Events" })).toBeVisible();
  await expectNoErrorScreen(page);
  expect(errors).toEqual([]);
  await context.close();
});

test("the three-step dialog creates a draft event and opens its dashboard", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/${orgSlug}`);
  // Escape hands focus back to the button that opened the dialog.
  const newEvent = page.getByRole("button", { name: "New event" }).first();
  await newEvent.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Create Event: Basics" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(newEvent).toBeFocused();
  await newEvent.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Create Event: Basics" })).toBeVisible();
  // The basics step blocks progress until the description has text.
  await dialog.getByRole("textbox", { name: /^Title/ }).fill(eventTitle);
  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Add a short description");
  await dialog.getByRole("textbox", { name: "About the event" }).fill("An evening meetup created by the redesign journey test.");
  await dialog.getByRole("button", { name: "Next" }).click();

  await expect(dialog.getByRole("heading", { name: "Create Event: Schedule" })).toBeVisible();
  // Focus moves into the new step instead of staying on Next.
  await expect(dialog.getByLabel(/^Start/)).toBeFocused();
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  start.setHours(18, 0, 0, 0);
  const local = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const startValue = local(start);
  await dialog.getByLabel(/^Start/).fill(startValue);
  await dialog.getByLabel(/^End/).fill(local(new Date(start.getTime() + 2 * 60 * 60 * 1000)));
  await dialog.getByRole("button", { name: "Next" }).click();

  await expect(dialog.getByRole("heading", { name: "Create Event: Location" })).toBeVisible();
  await dialog.getByRole("textbox", { name: /^Location/ }).fill("Community Hall, 1 Test Street");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();

  await page.waitForURL(/\/dashboard\/[^/]+\/event\/[^/?]+/);
  eventId = page.url().match(/\/event\/([^/?]+)/)![1]!;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { slug: true, status: true, startDateTime: true, timezone: true } });
  eventSlug = event.slug;
  expect(event.status).toBe("DRAFT");
  // The picked wall-clock time is read on the event's clock, not the browser's.
  expect(event.timezone).toBe("Asia/Kolkata");
  expect(event.startDateTime.toISOString()).toBe(zonedInputToIso(startValue, "Asia/Kolkata"));
  await expect(page.getByRole("heading", { level: 1, name: eventTitle })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("every event dashboard tab renders and is deep-linkable", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}`);
  const tabs = [
    ["Guests", "guests"],
    ["Event page", "page"],
    ["Emails", "emails"],
    ["Check-in", "check-in"],
    ["Feedback", "feedback"],
    ["Analytics", "analytics"],
    ["Settings", "settings"],
    ["Overview", null],
  ] as const;
  for (const [label, query] of tabs) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
    if (query) await expect(page).toHaveURL(new RegExp(`[?&]tab=${query}(&|$)`));
    else await expect(page).not.toHaveURL(/[?&]tab=/);
    // Some panels nest their own sub-tabs, so address the top-level panel by its tab's name.
    await expect(page.getByRole("tabpanel", { name: label, exact: true })).toBeVisible();
    await expectNoErrorScreen(page);
  }
  // A reload restores the tab from the address bar.
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}?tab=analytics`);
  await expect(page.getByRole("tab", { name: "Analytics", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
  await context.close();
});

test("the overview checklist publishes a draft event", async ({ browser }) => {
  const anonymous = await newContext(browser);
  expect((await anonymous.request.get(`/${orgSlug}/${eventSlug}`)).status()).toBe(404);
  await anonymous.close();

  const { context, page } = await ownerContext(browser);
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}`);
  await page.getByRole("button", { name: "Publish event" }).click();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe("PUBLISHED");
  await context.close();
});

test("publishing releases the public event page", async ({ browser }) => {
  const anonymous = await newContext(browser);
  const publicPage = await anonymous.newPage();
  const response = await publicPage.goto(`/${orgSlug}/${eventSlug}`);
  try {
    expect(response?.status()).toBe(200);
    await expect(publicPage.getByRole("heading", { level: 1, name: eventTitle })).toBeVisible();
    // An event created in the dialog has no saved section rows; its page
    // still shows the default sections, as the dashboard's Sections list says.
    await expect(publicPage.getByRole("region", { name: "About" })).toContainText("An evening meetup created by the redesign journey test.");
    await expect(publicPage.locator("#venue")).toContainText("Community Hall, 1 Test Street");
  } finally {
    await anonymous.close();
  }
});

test("a guest registers through the event card and reaches their ticket", async ({ browser }) => {
  await prisma.event.update({ where: { id: eventId }, data: { capacity: 1 } });
  const anonymous = await newContext(browser);
  const publicPage = await anonymous.newPage();
  expect((await publicPage.goto(`/${orgSlug}/${eventSlug}`))?.status()).toBe(200);
  await expect(publicPage.getByRole("heading", { level: 1, name: eventTitle })).toBeVisible();
  await anonymous.close();

  const context = await newContext(browser);
  const page = await register(context, firstGuest, "Register — it's free");
  await expect(page.getByText("You're in", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View your ticket" }).first().click();
  await page.waitForURL(/\/ticket\//);
  firstTicketPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { level: 1, name: eventTitle })).toBeVisible();
  await expect(page.getByText(new RegExp(`You.re in, ${firstGuest.name}`))).toBeVisible();
  await expect(page.getByRole("link", { name: "Event page" })).toBeVisible();
  // A reload keeps the registered state from this browser's saved ticket.
  await page.goto(`/${orgSlug}/${eventSlug}`);
  await expect(page.getByText("You're in", { exact: true })).toBeVisible();
  await expect(page.getByText("0 spots left")).toBeVisible();
  await context.close();
});

test("a full event offers its waitlist instead of a seat", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await register(context, secondGuest, "Join the waitlist");
  await expect(page.getByText("On the waitlist", { exact: true })).toBeVisible();
  const rsvp = await prisma.rSVP.findFirstOrThrow({ where: { eventId, guestEmail: secondGuest.email } });
  expect(rsvp.status).toBe("WAITLISTED");
  await context.close();
});

test("the guest list shows both registrations with their states", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}?tab=guests`);
  const list = page.getByRole("list", { name: "Guests" });
  const row = (name: string) => list.getByRole("listitem").filter({ hasText: name });
  await expect(row(firstGuest.name)).toHaveCount(1);
  await expect(row(secondGuest.name)).toHaveCount(1);
  await expect(row(secondGuest.name).getByRole("button", { name: `Give ${secondGuest.name} a spot` })).toBeVisible();

  await page.getByLabel("Search guests by name or email").fill("Ravi");
  await expect(row(secondGuest.name)).toHaveCount(1);
  await expect(row(firstGuest.name)).toHaveCount(0);
  await context.close();
});

test("an organiser checks in a confirmed guest by search", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  const errors = collectPageErrors(page);
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}/check-in`);
  await page.getByLabel("Name or email").fill(firstGuest.name);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Check in", exact: true }).first().click();
  const confirm = page.getByRole("dialog", { name: "Confirm check-in" });
  await expect(confirm.getByText(firstGuest.name)).toBeVisible();
  await confirm.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Checked in", { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await prisma.rSVP.findFirstOrThrow({ where: { eventId, guestEmail: firstGuest.email } })).checkedInAt).not.toBeNull();

  // The live ticket reflects the check-in.
  const ticket = await context.newPage();
  await ticket.goto(firstTicketPath);
  await expect(ticket.getByText(/checked in/i).first()).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test("account profile edits save and show across the account pages", async ({ browser }) => {
  const { context, page } = await ownerContext(browser);
  await page.goto("/account");
  const renamed = `Redesign Owner ${suffix}`;
  await page.getByRole("textbox", { name: /^Display name/ }).fill(renamed);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(async () => (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).name).toBe(renamed);
  for (const path of ["/account", "/account/registrations", "/account/organisations", "/account/security"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: renamed })).toBeVisible();
    await expectNoErrorScreen(page);
  }
  await page.goto("/account/organisations");
  await expect(page.getByText(orgName).first()).toBeVisible();
  await context.close();
});

test("dark mode is chosen once and persists across pages and reloads", async ({ browser }) => {
  const context = await newContext(browser, { colorScheme: "light" });
  const page = await context.newPage();
  await page.goto("/discover");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  await page.goto(`/${orgSlug}/${eventSlug}`);
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-mode", "light");
  await context.close();
});

test("the desktop sidebar collapses and stays collapsed after a reload", async ({ browser }) => {
  const { context, page } = await ownerContext(browser, { viewport: { width: 1440, height: 900 } });
  await page.goto(`/dashboard/${orgSlug}`);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  await context.close();
});

test("the dashboard navigation drawer works on a phone", async ({ browser }) => {
  const { context, page } = await ownerContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(`/dashboard/${orgSlug}`);
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Members" }).click();
  await page.waitForURL(`**/dashboard/${orgSlug}/members`);
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  await context.close();
});

test("a long unbroken event title, tag and place never widen /discover on a phone", async ({ browser }) => {
  const organisation = await prisma.organisation.findUniqueOrThrow({ where: { slug: orgSlug }, select: { id: true } });
  const title = `Unbroken${suffix}`.padEnd(200, "x");
  const start = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const event = await prisma.event.create({
    data: {
      organisationId: organisation.id,
      title,
      slug: `unbroken-${suffix}`,
      startDateTime: start,
      endDateTime: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      timezone: "UTC",
      location: `Hall${"y".repeat(300)}`,
      tags: ["z".repeat(80)],
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      page: { create: { isPublished: true, aboutHtml: "<p>Checks that long words wrap.</p>" } },
    },
  });
  try {
    for (const colorScheme of ["light", "dark"] as const) {
      const context = await newContext(browser, { colorScheme, viewport: { width: 390, height: 844 }, isMobile: true });
      const page = await context.newPage();
      // The longest search the page accepts, echoed in the results heading.
      await page.goto(`/discover?q=${encodeURIComponent(title.slice(0, 120))}`);
      await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
      expect(await horizontalOverflow(page), colorScheme).toBeLessThanOrEqual(1);
      await context.close();
    }
  } finally {
    await prisma.event.delete({ where: { id: event.id } });
  }
});

test("redesigned pages fit phone and desktop widths in light and dark mode", async ({ browser }) => {
  test.setTimeout(240_000);
  const publicPaths = ["/", "/discover", "/features", "/about", "/login", `/${orgSlug}`, `/${orgSlug}/${eventSlug}`, firstTicketPath];
  const ownerPaths = [
    "/dashboard",
    `/dashboard/${orgSlug}`,
    `/dashboard/${orgSlug}/event/${eventId}`,
    `/dashboard/${orgSlug}/event/${eventId}?tab=guests`,
    `/dashboard/${orgSlug}/event/${eventId}?tab=page`,
    `/dashboard/${orgSlug}/event/${eventId}?tab=emails`,
    `/dashboard/${orgSlug}/event/${eventId}/check-in`,
    `/dashboard/${orgSlug}/members`,
    `/dashboard/${orgSlug}/settings`,
    "/account",
    "/account/security",
  ];
  const problems: string[] = [];
  for (const colorScheme of ["light", "dark"] as const) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const { context, page } = await ownerContext(browser, { colorScheme, viewport });
      const errors = collectPageErrors(page);
      for (const path of [...publicPaths, ...ownerPaths]) {
        const response = await page.goto(path);
        const label = `${path} @${viewport.width}px ${colorScheme}`;
        if ((response?.status() ?? 0) >= 400) problems.push(`${label}: HTTP ${response?.status()}`);
        const overflow = await horizontalOverflow(page);
        if (overflow > 1) problems.push(`${label}: scrolls sideways by ${overflow}px`);
        if (await page.getByText(/Application error|Unhandled Runtime Error/i).count()) problems.push(`${label}: error screen`);
      }
      problems.push(...errors.map((error) => `page error (${viewport.width}px ${colorScheme}): ${error}`));
      await context.close();
    }
  }
  expect(problems).toEqual([]);
});
