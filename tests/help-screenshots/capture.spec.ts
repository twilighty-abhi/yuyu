import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import sharp from "sharp";
import { JudgingStatus, PrismaClient, ScoreNormalization } from "@prisma/client";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { EMAILS, ORG_SLUG, PASSWORD, seedHelpScreens, superAdminTotp, type SeedResult } from "./seed";

/*
 * Captures every screenshot the in-app guide references (content/help) from
 * a freshly seeded instance, writes public/help/<name>.png and records each
 * size in content/help/screenshots.json. One ordered story: later steps rely
 * on state from earlier ones (for example the door station, then its PIN page).
 *
 * Run with `npm run help:screenshots` against a disposable database only.
 */

// The seed encrypts the super-admin's authenticator secret and webhook secrets
// with the app's MFA_ENCRYPTION_KEY, read from the same .env files as Next.js.
// DATABASE_URL was already pointed at the disposable database by the config,
// and existing variables are never overridden.
loadEnvConfig(path.resolve(__dirname, "../.."), true, { info: () => {}, error: console.error });

test.describe.configure({ mode: "serial", timeout: 5 * 60_000 });

const ROOT = path.resolve(__dirname, "../..");
const OUTPUT_DIR = path.join(ROOT, "public/help");
const SIZES_FILE = path.join(ROOT, "content/help/screenshots.json");

const prisma = new PrismaClient();
let seed: SeedResult;
let ipCounter = 10;

const dashboard = () => `/dashboard/${ORG_SLUG}`;
const eventDashboard = (event: keyof SeedResult["events"], query = "") => `${dashboard()}/event/${seed.events[event].id}${query}`;

/* ---------- Browser helpers ---------- */

/** Each context gets its own client address so per-IP rate limits never couple steps. */
async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.51.100.${(ipCounter++ % 240) + 10}` });
  // No full reloads from the dev server: edits elsewhere in the tree (and
  // Turbopack's occasional "restart" loop on a cold start) must not reload a
  // page halfway through a capture. Everything else passes through, since the
  // client needs the socket to hydrate.
  await context.routeWebSocket(/\/_next\/(webpack-)?hmr/, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (typeof message === "string" && /"type":"(reloadPage|restart)"/.test(message)) return;
      socket.send(message);
    });
    socket.onMessage((message) => server.send(message));
  });
  // Keep the Next.js development indicator out of every screenshot.
  await context.addInitScript(() => {
    const hide = () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.appendChild(style);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  });
  return context;
}

/** Waits until React has hydrated the page, so clicks and typing reach controlled state. */
async function hydrated(page: Page) {
  await expect
    // A cold dev server may reload the page once while it compiles; keep polling.
    .poll(() => page.evaluate(() => Object.keys(document.body).some((key) => key.startsWith("__reactFiber")) && !document.querySelector("[data-nextjs-dialog]")).catch(() => false), { timeout: 90_000 })
    .toBe(true);
}

async function open(page: Page, url: string) {
  await page.goto(url, { timeout: 120_000 });
  await hydrated(page);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
}

async function signIn(page: Page, email: string, totp?: () => string) {
  await page.request.get("/api/auth/csrf");
  for (let attempt = 1; ; attempt++) {
    await open(page, "/login");
    await page.getByRole("textbox", { name: /^Email/ }).fill(email);
    await page.locator('input[type="password"]:visible').fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    if (totp) {
      const code = page.getByRole("textbox", { name: /Authenticator or recovery code/ });
      await expect(code).toBeVisible({ timeout: 60_000 });
      await code.fill(totp());
      await page.getByRole("button", { name: "Verify and sign in" }).click();
    }
    const failed = page.getByRole("alert").filter({ hasText: /Invalid/ });
    await expect.poll(async () => !new URL(page.url()).pathname.startsWith("/login") || (await failed.count()) > 0, { timeout: 60_000 }).toBe(true);
    if (!new URL(page.url()).pathname.startsWith("/login")) return;
    if (attempt === 3) throw new Error(`Sign-in failed three times for ${email}`);
  }
}

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const sessions = new Map<string, StorageState>();

/** Signs in once per person and reuses the session (repeated sign-ins trip the auth rate limit). */
async function userPage(browser: Browser, email: string, options: { fresh?: boolean } = {}) {
  if (!sessions.has(email) || options.fresh) {
    const signInContext = await newContext(browser);
    await signIn(await signInContext.newPage(), email);
    sessions.set(email, await signInContext.storageState());
    await signInContext.close();
  }
  const context = await newContext(browser, { storageState: sessions.get(email) });
  return { context, page: await context.newPage() };
}

async function anonymousPage(browser: Browser) {
  const context = await newContext(browser);
  return { context, page: await context.newPage() };
}

/* ---------- Capture helpers ---------- */

/** The nearest bordered or filled, rounded ancestor of `inner` (a card, dialog or panel). */
async function card(inner: Locator) {
  const marker = `card-${Math.random().toString(36).slice(2)}`;
  await inner.first().evaluate((node, value) => {
    let element: HTMLElement | null = node as HTMLElement;
    while (element && element !== document.body) {
      const style = getComputedStyle(element);
      const filled = style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent";
      if ((parseFloat(style.borderTopWidth) > 0 || filled) && parseFloat(style.borderTopLeftRadius) >= 8 && element.offsetWidth >= 240) break;
      element = element.parentElement;
    }
    (element && element !== document.body ? element : (node as HTMLElement)).setAttribute("data-help-card", value);
  }, marker);
  return inner.page().locator(`[data-help-card="${marker}"]`);
}

/** A locator that keeps matching `inner` even after the page hides it from the accessibility tree (an open menu). */
async function mark(inner: Locator) {
  const marker = `mark-${Math.random().toString(36).slice(2)}`;
  await inner.first().evaluate((node, value) => (node as HTMLElement).setAttribute("data-help-mark", value), marker);
  return inner.page().locator(`[data-help-mark="${marker}"]`);
}

type CaptureOptions = { pad?: number; padTop?: number; maxHeight?: number; fullWidth?: boolean };

/** Screenshots the union of `targets` (plus padding) and records the PNG's size. */
async function capture(page: Page, name: string, targets: Locator | Locator[], options: CaptureOptions = {}) {
  const { pad = 16, padTop = pad, maxHeight } = options;
  const list = Array.isArray(targets) ? targets : [targets];
  for (const target of list) await expect(target.first()).toBeVisible({ timeout: 60_000 });
  // Let images, fonts and transitions settle before measuring.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, width: document.documentElement.scrollWidth }));
  const boxes = [];
  for (const target of list) {
    const box = await target.first().boundingBox();
    if (!box) throw new Error(`${name}: target has no box`);
    boxes.push({ x: box.x + scroll.x, y: box.y + scroll.y, right: box.x + scroll.x + box.width, bottom: box.y + scroll.y + box.height });
  }
  const x = options.fullWidth ? 0 : Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.x)) - pad));
  const y = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.y)) - padTop));
  const right = options.fullWidth ? scroll.width : Math.min(scroll.width, Math.ceil(Math.max(...boxes.map((box) => box.right)) + pad));
  let height = Math.ceil(Math.max(...boxes.map((box) => box.bottom)) + pad) - y;
  if (maxHeight) height = Math.min(height, maxHeight);
  const raw = await page.screenshot({ clip: { x, y, width: right - x, height }, fullPage: true, animations: "disabled", caret: "hide" });
  await save(name, raw);
}

/** A dashboard tab panel already has top padding of its own. */
const capturePanel = (page: Page, name: string, panel: Locator, options: CaptureOptions = {}) => capture(page, name, panel, { padTop: 0, ...options });

/**
 * Makes the viewport as tall as the page, so bars stuck to the bottom of the
 * window sit where they belong and menus open downwards.
 */
async function tallViewport(page: Page, height?: number) {
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height: height ?? pageHeight });
}

/** Captures exactly what the viewport shows. */
async function captureViewport(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await save(name, await page.screenshot({ animations: "disabled", caret: "hide" }));
}

async function save(name: string, raw: Buffer) {
  // A 256-colour palette keeps UI screenshots small and visually lossless.
  const png = await sharp(raw).png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 }).toBuffer();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, `${name}.png`), png);
  const { width, height } = await sharp(png).metadata();
  const sizes = JSON.parse(fs.readFileSync(SIZES_FILE, "utf8")) as Record<string, { width: number; height: number }>;
  sizes[name] = { width: width!, height: height! };
  const sorted = Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(SIZES_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
}

const heading = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("heading", { name, exact: typeof name === "string" }).first();
const visibleTabPanel = (page: Page) => page.getByRole("tabpanel").filter({ visible: true }).first();

/** Clicks a (sub-)tab by its accessible name and waits for its panel. */
async function openTab(page: Page, name: string | RegExp) {
  await page.getByRole("tab", { name }).filter({ visible: true }).first().click();
  await page.waitForTimeout(300);
}

/** Drops queued email so a capture run never delivers anything. */
async function discardQueuedEmail() {
  await prisma.outboxMessage.deleteMany({});
}

/* ---------- Story ---------- */

test.beforeAll(async () => {
  seed = await seedHelpScreens(prisma);
});

test.afterAll(async () => {
  await discardQueuedEmail();
  await prisma.$disconnect();
});

test("public pages: sign-in, Discover, event registration and ticket", async ({ browser }) => {
  const { context, page } = await anonymousPage(browser);

  await open(page, "/login");
  await expect(page.getByRole("tab", { name: "Create account" })).toBeVisible();
  await captureViewport(page, "login-page");

  await open(page, "/discover");
  await capture(page, "discover-page", [heading(page, "Discover events"), page.getByRole("link", { name: /Riverside Tech Night: Building/ }).first()], { fullWidth: true, pad: 24 });

  await open(page, `/${ORG_SLUG}/${seed.events.main.slug}`);
  await page.getByRole("button", { name: /Register/ }).first().click();
  const dialog = page.getByRole("dialog", { name: `Register for ${seed.events.main.title}` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /^Name/ }).fill("Sam Rivers");
  await dialog.getByRole("textbox", { name: /^Email/ }).fill("sam.rivers@example.org");
  await dialog.getByText("Yes", { exact: true }).click();
  await dialog.getByRole("textbox", { name: /dietary/ }).fill("Vegetarian");
  await capture(page, "event-registration-dialog", dialog, { pad: 0 });

  await open(page, `/ticket/${seed.ticketToken}`);
  await capture(page, "ticket-page", [page.getByRole("link", { name: "Event page" }), page.getByText("Confirmed", { exact: true }), page.getByText("Save ticket", { exact: true }), page.getByText(/Cancel registration/)], { pad: 40 });
  await context.close();
});

test("organisation pages", async ({ browser }) => {
  const { context, page } = await userPage(browser, EMAILS.owner);

  await open(page, `${dashboard()}/members`);
  await capture(page, "organisation-members", [heading(page, "Team"), await card(heading(page, "Invite people")), await card(page.getByText("dev@example.org", { exact: false }))]);

  await open(page, `${dashboard()}/settings`);
  await capture(page, "organisation-settings-profile", await card(heading(page, "Profile")), { pad: 8 });

  await open(page, `${dashboard()}/settings/api`);
  await capture(page, "settings-api-access", [heading(page, "API access"), await card(page.getByText("Attendance sync", { exact: true }))]);

  await open(page, `${dashboard()}/settings/webhooks`);
  await capture(page, "settings-webhooks", [heading(page, "Webhooks"), page.getByText(/How to verify signatures/)]);

  await open(page, "/dashboard/org/new");
  await page.getByRole("textbox", { name: /^Name/ }).fill("Harbour Book Club");
  await page.getByRole("textbox", { name: /^Web address/ }).fill("harbour-book-club");
  await page.getByRole("textbox", { name: /^Description/ }).fill("Monthly meetups for readers in the harbour district.");
  await expect(page.getByText("URL slug is available!")).toBeVisible();
  await capture(page, "create-organisation-form", [heading(page, "Create an organisation"), page.getByRole("button", { name: "Create organisation" })], { pad: 24 });

  await open(page, dashboard());
  await page.getByRole("button", { name: "New series" }).click();
  const series = page.getByRole("dialog");
  await series.getByRole("textbox", { name: /^Title/ }).fill("Saturday Repair Café");
  await series.getByRole("textbox", { name: /^Description/ }).fill("Fix things together, every other Saturday morning.");
  await series.getByLabel(/First occurrence start/).fill("2026-11-07T10:00");
  await series.getByLabel(/First occurrence end/).fill("2026-11-07T13:00");
  await series.getByRole("textbox", { name: /Recurrence/ }).fill("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA;COUNT=10");
  await series.getByRole("combobox", { name: /Timezone/ }).click();
  await page.getByRole("option", { name: "Europe/London" }).click();
  await capture(page, "create-series-dialog", series, { pad: 0 });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New event" }).first().click();
  const create = page.getByRole("dialog");
  await expect(create.getByRole("heading", { name: "Create Event: Basics" })).toBeVisible();
  await create.getByRole("textbox", { name: /^Title/ }).fill("Autumn Code & Coffee");
  await create.getByRole("textbox", { name: "About the event" }).fill("A relaxed morning of coding, coffee and good company. Bring a project or just come and say hello.");
  const tags = create.getByRole("textbox", { name: /^Tags/ });
  for (const tag of ["coffee", "coding"]) {
    await tags.fill(tag);
    await tags.press("Enter");
  }
  await capture(page, "create-event-dialog-basics", create, { pad: 0 });
  await context.close();
});

test("account settings", async ({ browser }) => {
  const { context, page } = await userPage(browser, EMAILS.owner);

  await open(page, "/account");
  await capture(page, "account-profile", [await card(heading(page, "Profile")), await card(heading(page, "Appearance"))], { pad: 8 });

  await open(page, "/account/security");
  await capture(page, "account-security-two-step", await card(heading(page, "Two-step verification")), { pad: 8 });

  await open(page, "/account/organisations");
  await capture(page, "account-organisations", await card(heading(page, "Your organisations")), { pad: 8 });
  await context.close();
});

test("event overview, details and publishing", async ({ browser }) => {
  const { context, page } = await userPage(browser, EMAILS.owner);

  await open(page, eventDashboard("main"));
  const readiness = await card(page.getByText(/things? left/).first());
  await capture(page, "event-dashboard-overview", [page.getByRole("link", { name: "All events" }), readiness]);
  await capture(page, "event-overview-share-card", await card(heading(page, "Share")), { pad: 8 });

  await open(page, eventDashboard("draft"));
  await capture(page, "event-overview-readiness", await card(page.getByText(/things? left/).first()), { pad: 8 });

  await open(page, eventDashboard("main", "?tab=page&sub=details"));
  await capture(page, "event-details-form", [await card(page.getByText("Public URL")), await card(heading(page, /^Basics/))]);
  const publishing = await card(heading(page, "Publishing"));
  await capture(page, "event-publishing-section", publishing, { pad: 8 });
  await capture(page, "publishing-sign-ups", [publishing.getByText("Sign-ups", { exact: true }), publishing.getByText(/Sign-ups close 2 hours before the start/)], { pad: 12 });

  await open(page, eventDashboard("hack", "?tab=page&sub=details"));
  const teamPublishing = await card(heading(page, "Publishing"));
  await capture(page, "publishing-team-registration", [teamPublishing.getByText("Team registration", { exact: true }), teamPublishing.getByText(/Solo sign-ups can/)], { pad: 12 });
  await context.close();
});

test("cover photo editor", async ({ browser }, testInfo) => {
  const { context, page } = await userPage(browser, EMAILS.owner);
  const cover = testInfo.outputPath("cover.png");
  await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1200" cy="260" r="140" fill="#fde68a" opacity="0.8"/><path d="M0 700 Q400 560 800 700 T1600 680 V900 H0Z" fill="#134e4a"/></svg>`,
  )).png().toFile(cover);
  await open(page, eventDashboard("main", "?tab=page&sub=details"));
  await (await card(heading(page, "Cover image"))).locator('input[type="file"]').setInputFiles(cover);
  const dialog = page.getByRole("dialog", { name: "Edit cover photo" });
  await expect(dialog).toBeVisible();
  await capture(page, "cover-photo-editor", dialog, { pad: 0 });
  await context.close();
});

test("event page content and registration form", async ({ browser }) => {
  const { context, page } = await userPage(browser, EMAILS.owner);

  await open(page, eventDashboard("main", "?tab=page&sub=page"));
  await capture(page, "event-page-sections", [await card(heading(page, "Colour")), await card(heading(page, "Sections"))]);

  const speakers = page.locator("section").filter({ has: heading(page, "Speakers") });
  await speakers.getByRole("button", { name: /^Add speaker/i }).click();
  const form = speakers.locator("form").first();
  await form.getByRole("textbox", { name: /^Name/ }).fill("Priya Natarajan");
  await form.getByRole("textbox", { name: /^Headline/ }).fill("Developer advocate");
  await form.getByRole("textbox", { name: /^Organisation/ }).fill("Quay Cloud");
  await capture(page, "event-page-speaker-form", [heading(speakers, "Speakers"), form]);

  await open(page, eventDashboard("main", "?tab=page&sub=registration"));
  await capture(page, "registration-form-builder", visibleTabPanel(page).getByRole("tabpanel").filter({ visible: true }).first(), { maxHeight: 1300 });
  await context.close();
});

test("programme schedule", async ({ browser }) => {
  const { context, page } = await userPage(browser, EMAILS.owner);
  await open(page, `${eventDashboard("main")}/schedule`);
  await capture(page, "programme-schedule", [heading(page, "Programme schedule"), await card(page.getByText("Workshop Room", { exact: true }).last())], { maxHeight: 1500 });
  await capture(page, "programme-live-delay", await card(page.getByText(/5 sessions · delays stay in this track/)), { pad: 8 });
  await context.close();
});

test("guests", async ({ browser }) => {
  const { context, page } = await userPage(browser, EMAILS.owner);

  await open(page, eventDashboard("main", "?tab=guests"));
  const panel = visibleTabPanel(page);
  const rows = panel.getByText(/registered on|asked|joined waitlist/);
  await capture(page, "guests-people", [heading(panel, "Guests"), await card(rows.nth(9))], { pad: 20 });
  await capture(page, "guests-people-exports", [heading(panel, "Guests"), page.getByRole("button", { name: "Add guest" }), await card(rows.nth(1))], { pad: 20 });

  await tallViewport(page, 1400);
  // An open menu hides the rest of the page from role queries, so pin these first.
  const guestsHeading = await mark(heading(panel, "Guests"));
  const views = await mark(page.getByRole("button", { name: "Views" }));
  const addGuest = await mark(page.getByRole("button", { name: "Add guest" }));
  await views.click();
  const menu = page.getByRole("menu", { name: "Views" });
  await expect(menu).toBeVisible();
  await capture(page, "guests-views-menu", [guestsHeading, views, addGuest, menu], { pad: 24 });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 800 });

  await open(page, eventDashboard("main", "?tab=guests&sub=invites"));
  await capturePanel(page, "guests-invites", visibleTabPanel(page).getByRole("tabpanel").filter({ visible: true }).first());

  await open(page, eventDashboard("hack", "?tab=guests&sub=teams"));
  const teams = visibleTabPanel(page);
  await capture(page, "guests-teams", [heading(teams, "Teams"), await card(teams.getByText("Solo Sparks", { exact: true }))]);
  await context.close();
});

test("emails, settings and co-organisers", async ({ browser }) => {
  const { context, page } = await userPage(browser, EMAILS.owner);

  await open(page, eventDashboard("main", "?tab=emails"));
  await page.getByRole("button", { name: /Reminder before the event/ }).click();
  await expect(page.getByRole("textbox", { name: /^Subject/ })).not.toHaveValue("");
  await page.waitForTimeout(1500);
  await tallViewport(page);
  await capturePanel(page, "emails-composer", visibleTabPanel(page), { maxHeight: 1500 });
  await page.setViewportSize({ width: 1280, height: 800 });

  await open(page, eventDashboard("main", "?tab=settings"));
  await capture(page, "event-settings-co-organisers", await card(heading(page, "Co-organisers")), { pad: 8 });
  await context.close();
});

test("check-in", async ({ browser }) => {
  // Turning on the door station needs a recent sign-in.
  const { context, page } = await userPage(browser, EMAILS.owner, { fresh: true });

  await open(page, eventDashboard("main", "?tab=check-in"));
  const station = await card(heading(page, "Door station"));
  await station.getByRole("button", { name: "Turn on station" }).click();
  await expect(station.getByRole("button", { name: "Hide" })).toBeVisible({ timeout: 30_000 });
  await station.getByRole("button", { name: "Hide" }).click();
  await expect(station.getByRole("button", { name: "Show PIN" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /enabled/ })).toHaveCount(0, { timeout: 15_000 });
  await capture(page, "door-station-card", station, { pad: 8 });
  const stationUrl = (await station.locator("p.font-mono").innerText()).trim();

  await open(page, `${eventDashboard("main")}/check-in`);
  await capture(page, "check-in-desk", [heading(page, "Check-in desk"), await card(page.getByText("Manual code", { exact: true })), await card(page.getByText("Search attendees", { exact: true }))], { pad: 16 });

  await page.getByRole("switch", { name: "ID card printing" }).click();
  await page.getByRole("button", { name: "Set up cards" }).click();
  const badges = page.getByRole("dialog");
  await expect(badges).toBeVisible();
  await capture(page, "badge-designer", badges, { pad: 0 });
  await page.keyboard.press("Escape");
  await page.getByRole("switch", { name: "ID card printing" }).click();

  await page.getByRole("button", { name: "Make available offline" }).click();
  await expect(page.getByText("Offline check-in ready")).toBeVisible({ timeout: 30_000 });
  await capture(page, "check-in-offline-ready", [heading(page, "Check-in desk"), await card(page.getByText("Offline check-in ready"))], { pad: 16 });

  // A fresh load drops the "saved on this device" toast.
  await open(page, `${eventDashboard("main")}/check-in`);
  await page.getByRole("link", { name: /Swag collection/ }).click();
  await hydrated(page);
  await expect(heading(page, /Guests for Swag collection/)).toBeVisible();
  await capture(page, "check-in-list-desk", [page.getByRole("link", { name: /^Entry/ }), page.getByText("Manage lists", { exact: true }), page.getByRole("list", { name: "Guests for Swag collection" }).getByRole("listitem").nth(4)], { pad: 16 });

  // The station link is meant for a volunteer's phone without an account.
  const volunteer = await anonymousPage(browser);
  await open(volunteer.page, stationUrl);
  await expect(volunteer.page.getByText(/station PIN/i).first()).toBeVisible();
  await captureViewport(volunteer.page, "door-station-pin");
  await volunteer.context.close();
  await context.close();
});

test("feedback, certificates and analytics", async ({ browser }) => {
  const { context, page } = await userPage(browser, EMAILS.owner);

  await open(page, eventDashboard("past", "?tab=feedback"));
  await capturePanel(page, "feedback-tab", visibleTabPanel(page), { maxHeight: 1400 });

  // A taller window shows the whole designer, with the name layer selected.
  await tallViewport(page, 1250);
  await page.getByRole("button", { name: "Design certificate" }).click();
  const designer = page.getByRole("dialog", { name: "Design certificate" });
  await expect(designer).toBeVisible();
  await designer.getByText("{{name}}", { exact: true }).click();
  await designer.evaluate((node) => node.querySelectorAll("*").forEach((element) => { element.scrollTop = 0; }));
  await capture(page, "certificate-designer", designer, { pad: 0 });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 800 });

  await open(page, eventDashboard("past", "?tab=analytics"));
  await capturePanel(page, "analytics-tab", visibleTabPanel(page));
  await context.close();
});

test("hackathon judging while judging is open", async ({ browser }) => {
  const { context, page } = await userPage(browser, EMAILS.owner);

  await open(page, eventDashboard("hack", "?tab=judging"));
  await capture(page, "judging-setup", visibleTabPanel(page).getByRole("tabpanel").filter({ visible: true }).first());
  await capture(page, "judging-rubric", await card(heading(page, "Rubric").or(page.getByText("Rubric", { exact: true })).first()), { pad: 8 });

  await openTab(page, /^Submissions/);
  await capture(page, "judging-submissions", visibleTabPanel(page).getByRole("tabpanel").filter({ visible: true }).first());

  await openTab(page, /^Progress/);
  await capture(page, "judging-progress", [await card(page.getByText("Judging progress", { exact: true })), await card(page.getByText("Projects below target", { exact: true }))]);
  await context.close();

  // A judge (a JUDGE-only co-organiser) scores a project.
  const judge = await userPage(browser, EMAILS.judge);
  await open(judge.page, eventDashboard("hack"));
  await judge.page.getByRole("button", { name: /Cycle Safe/ }).click();
  const workspace = judge.page.locator("section").filter({ has: judge.page.locator("#judge-submission-title") });
  await expect(workspace).toBeVisible();
  for (const [criterion, score] of [["Impact", "8"], ["Technical execution", "7"]] as const) {
    await workspace.getByRole("group", { name: criterion }).getByRole("radio", { name: `${score} out of 10` }).check({ force: true });
  }
  await workspace.getByRole("textbox", { name: /Private comment/ }).fill("Strong idea with a clear path to the council. The demo needs a mobile layout.");
  await capture(judge.page, "judge-score-workspace", workspace, { maxHeight: 1500 });
  await judge.context.close();
});

test("hackathon results", async ({ browser }) => {
  // Close judging, pick winners and publish results as an organiser would.
  const hack = seed.events.hack;
  const awards = await prisma.eventAward.findMany({ where: { eventId: hack.id }, orderBy: { position: "asc" } });
  const byTitle = Object.fromEntries(seed.submissions.map((submission) => [submission.title, submission.id]));
  await prisma.eventAwardWinner.createMany({
    data: [
      { awardId: awards[0]!.id, submissionId: byTitle["FoodShare Finder"]!, place: 1 },
      { awardId: awards[0]!.id, submissionId: byTitle["Volunteer Rota"]!, place: 2 },
      { awardId: awards[1]!.id, submissionId: byTitle["Volunteer Rota"]!, place: 1 },
      { awardId: awards[2]!.id, submissionId: byTitle["Accessible Bus Times"]!, place: 1 },
    ],
  });
  const now = new Date();
  await prisma.event.update({
    where: { id: hack.id },
    data: { judgingStatus: JudgingStatus.CLOSED, scoreNormalization: ScoreNormalization.ZSCORE, resultsPublishedAt: now, resultsAnnouncedAt: now },
  });

  const { context, page } = await userPage(browser, EMAILS.owner);
  await open(page, eventDashboard("hack", "?tab=judging&sub=judging-results"));
  await capture(page, "judging-results", visibleTabPanel(page).getByRole("tabpanel").filter({ visible: true }).first(), { maxHeight: 1500 });
  await context.close();

  const visitor = await anonymousPage(browser);
  await open(visitor.page, `/${ORG_SLUG}/${hack.slug}/results`);
  await capture(visitor.page, "public-results-page", visitor.page.locator("main"), { pad: 0, maxHeight: 1400 });
  await visitor.context.close();
});

test("super-admin pages", async ({ browser }) => {
  const totp = superAdminTotp(seed.mfaSecret);
  const context = await newContext(browser);
  const page = await context.newPage();
  // Sign in with the current code, then step up with the next one: each code works once.
  await signIn(page, EMAILS.superAdmin, () => totp.generate());

  await open(page, "/super-admin-mfa");
  const code = page.getByRole("textbox", { name: /Six-digit authenticator code/ });
  await expect(code).toBeVisible();
  await captureViewport(page, "super-admin-mfa");
  await code.fill(totp.generate({ timestamp: Date.now() + 30_000 }));
  await page.getByRole("button", { name: /Verify/ }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/super-admin") && !url.pathname.startsWith("/super-admin-mfa"), { timeout: 60_000 });

  await open(page, "/super-admin");
  await capture(page, "super-admin-overview", page.locator("main"), { pad: 0, maxHeight: 1220 });
  await open(page, "/super-admin/operations");
  await capture(page, "super-admin-operations", page.locator("main"), { pad: 0, maxHeight: 1700 });
  await open(page, "/super-admin/security");
  await capture(page, "super-admin-security", page.locator("main"), { pad: 0 });
  await open(page, "/super-admin/settings");
  await capture(page, "super-admin-settings", [heading(page, "Instance settings"), await card(page.getByText("Backup configuration", { exact: true })), page.getByRole("button", { name: "Save instance settings" })], { pad: 24 });
  await context.close();
});
