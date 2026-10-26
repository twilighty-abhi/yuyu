import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPrivacyType, EventStatus, MembershipRole, PrismaClient, RsvpStatus } from "@prisma/client";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/*
 * Attendance confirmation ("Are you still coming?", docs/FEATURES.md):
 * the organiser asks from the Emails tab after a preview and an explicit
 * confirmation; a guest opens their link from the queued email, sees their
 * own name and email, and answers No with a note; the organiser then sees the
 * reply in the Emails card, the People filter and badge, and the CSV. The
 * link is a private, unindexed capability, and a bad token is a real 404.
 */
test.describe.configure({ mode: "serial" });
const prisma = new PrismaClient();
const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `attend-${suffix}`;
const password = "attendance-confirmation-browser-password";
const ownerEmail = `attend-owner-${suffix}@example.test`;
const declinerEmail = `attend-decliner-${suffix}@example.test`;
const comingEmail = `attend-coming-${suffix}@example.test`;
const waitingEmail = `attend-waiting-${suffix}@example.test`;
const declinerName = `Dora Decliner ${suffix.slice(0, 6)}`;
const comingName = `Cal Coming ${suffix.slice(0, 6)}`;
const note = `Train strike, sorry ${suffix.slice(0, 6)}`;
const testEmails = [declinerEmail, comingEmail, waitingEmail];
let organisationId = "";
let ownerId = "";
let eventId = "";
let declinerRsvpId = "";
let ownerSession: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;

type Payload = Record<string, unknown>;

test.beforeAll(async () => {
  organisationId = (await prisma.organisation.create({ data: { name: `Attendance ${suffix}`, slug: orgSlug } })).id;
  eventId = (await prisma.event.create({
    data: {
      organisationId,
      title: `Attendance journey ${suffix}`,
      slug: `attendance-journey-${suffix}`,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-01T12:00:00.000Z"),
      timezone: "UTC",
      location: "Main hall",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      page: { create: { isPublished: true } },
    },
  })).id;
  declinerRsvpId = (await prisma.rSVP.create({ data: { eventId, attendeeKey: `guest:${declinerEmail}`, guestName: declinerName, guestEmail: declinerEmail, status: RsvpStatus.CONFIRMED } })).id;
  await prisma.rSVP.create({ data: { eventId, attendeeKey: `guest:${comingEmail}`, guestName: comingName, guestEmail: comingEmail, status: RsvpStatus.CONFIRMED } });
  // Never asked: only CONFIRMED guests are.
  await prisma.rSVP.create({ data: { eventId, attendeeKey: `guest:${waitingEmail}`, guestName: "Wendy Waiting", guestEmail: waitingEmail, status: RsvpStatus.WAITLISTED } });
  ownerId = (await prisma.user.create({
    data: {
      email: ownerEmail,
      name: "Attendance Owner",
      passwordHash: await bcrypt.hash(password, 12),
      emailVerified: new Date(),
      memberships: { create: { organisationId, role: MembershipRole.OWNER } },
    },
  })).id;
});

/** Queued questions go to test addresses; drop them before any worker pass can try to deliver them. */
async function discardQueuedTestEmail() {
  const messages = await prisma.outboxMessage.findMany({ select: { id: true, payload: true } });
  const ids = messages.filter((message) => testEmails.includes(String((message.payload as Payload | null)?.to))).map((message) => message.id);
  if (ids.length) await prisma.outboxMessage.deleteMany({ where: { id: { in: ids } } });
}

test.afterAll(async () => {
  await discardQueuedTestEmail();
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});

async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  // Each context gets its own client address so per-IP limits don't couple tests.
  return browser.newContext({ ...options, extraHTTPHeaders: { "cf-connecting-ip": `192.0.2.${10 + Math.floor(Math.random() * 200)}` } });
}

async function waitForHydration(page: Page, selector: string) {
  await expect.poll(() => page.locator(selector).filter({ visible: true }).first().evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
}

async function ownerPage(browser: Browser) {
  if (!ownerSession) {
    const context = await newContext(browser);
    const page = await context.newPage();
    await page.request.get("/api/auth/csrf");
    await page.goto("/login?callbackUrl=%2Fdashboard");
    await waitForHydration(page, "input[type=password]");
    await page.getByRole("textbox", { name: /^Email/ }).fill(ownerEmail);
    await page.locator('input[type="password"]:visible').fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    ownerSession = await context.storageState();
    await context.close();
  }
  const context = await newContext(browser, { storageState: ownerSession });
  return { context, page: await context.newPage() };
}

/** The raw link token exists only in the queued email. */
async function queuedToken(rsvpId: string) {
  let token = "";
  await expect
    .poll(async () => {
      const rows = await prisma.outboxMessage.findMany({ where: { kind: "attendance-check", payload: { path: ["rsvpId"], equals: rsvpId } }, select: { payload: true } });
      token = String((rows[0]?.payload as Payload | undefined)?.token ?? "");
      return token.length;
    }, { message: "waiting for a queued attendance question" })
    .toBe(43);
  return token;
}

const dashboard = () => `/dashboard/${orgSlug}/event/${eventId}`;
const card = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Attendance confirmation" }) });

let declinerToken = "";
let comingToken = "";

test("nothing is asked until the organiser previews and confirms the send", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await ownerPage(browser);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${dashboard()}?tab=emails`);
  await expect(card(page)).toBeVisible({ timeout: 60_000 });
  await expect(card(page)).toContainText("Not sent yet. 2 confirmed guests would be asked.");
  expect(await prisma.attendanceCheck.count({ where: { eventId } })).toBe(0);

  const ask = card(page).getByRole("button", { name: "Ask guests to confirm attendance" });
  await waitForHydration(page, "#attendance-check-heading ~ * button, section button");
  await ask.click();
  const preview = page.getByRole("dialog", { name: "Ask 2 guests to confirm" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("2 confirmed guests");
  await expect(preview).toContainText("Each guest gets one email");
  // Cancelling the preview sends nothing.
  await preview.getByRole("button", { name: "Cancel" }).click();
  await expect(preview).toBeHidden();
  expect(await prisma.attendanceCheck.count({ where: { eventId } })).toBe(0);

  await ask.click();
  await page.getByRole("dialog", { name: "Ask 2 guests to confirm" }).getByRole("button", { name: "Send to 2 guests" }).click();
  await expect(page.getByText("Asking 2 guests to confirm. Emails are on their way.")).toBeVisible({ timeout: 20_000 });

  declinerToken = await queuedToken(declinerRsvpId);
  const coming = await prisma.rSVP.findFirstOrThrow({ where: { eventId, guestEmail: comingEmail } });
  comingToken = await queuedToken(coming.id);
  await discardQueuedTestEmail();
  expect(await prisma.attendanceCheck.count({ where: { eventId } })).toBe(2);
  expect(await prisma.attendanceCheck.count({ where: { rsvp: { guestEmail: waitingEmail } } })).toBe(0);

  // After the send the card shows the status, and the button asks only newcomers.
  await expect(card(page)).toContainText("Asked 2 guests", { timeout: 20_000 });
  await expect(card(page)).toContainText("by Attendance Owner");
  await expect(card(page).getByRole("button", { name: "Ask newly confirmed guests" })).toBeDisabled();
  expect(errors).toEqual([]);
  await context.close();
});

test("the guest answers No with a note from their private link", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await newContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await page.goto(`/attend/${declinerToken}?answer=no`);
  expect(response?.status()).toBe(200);
  const headers = response!.headers();
  // The production server sends the proxy's `private, no-cache, no-store, …`;
  // `next dev` replaces it with its own `no-cache, must-revalidate`.
  const cacheControl = headers["cache-control"] ?? "";
  if (process.env.PLAYWRIGHT_PRODUCTION_SERVER === "1") {
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");
  } else {
    expect(cacheControl).toMatch(/no-store|no-cache/);
  }
  expect(cacheControl).not.toMatch(/public|s-maxage/);
  expect(headers["referrer-policy"]).toBe("no-referrer");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await expect(page.getByRole("heading", { level: 1 })).toContainText(`Attendance journey ${suffix}`);
  const registration = page.getByRole("region", { name: "Your registration" });
  await expect(registration).toContainText(declinerName);
  await expect(registration).toContainText(declinerEmail);
  // Nothing about anyone else, and no ticket link.
  await expect(page.locator("body")).not.toContainText(comingName);
  await expect(page.locator('a[href*="/ticket/"]')).toHaveCount(0);

  await waitForHydration(page, "form button");
  // The email's No button preselects No; it never submits on its own.
  await expect(page.getByRole("radio", { name: "No, I can't make it" })).toBeChecked();
  expect((await prisma.attendanceCheck.findUniqueOrThrow({ where: { rsvpId: declinerRsvpId } })).response).toBeNull();

  await page.getByRole("textbox", { name: /Note for the organisers/ }).fill(note);
  await page.getByRole("button", { name: "Send my answer" }).click();
  await expect(page.getByText("Thanks for letting us know")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status")).toContainText(note);
  await expect.poll(async () => (await prisma.attendanceCheck.findUniqueOrThrow({ where: { rsvpId: declinerRsvpId } })).response).toBe("NOT_ATTENDING");
  expect((await prisma.attendanceCheck.findUniqueOrThrow({ where: { rsvpId: declinerRsvpId } })).note).toBe(note);
  // Release is off by default: the place is kept.
  expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: declinerRsvpId } })).status).toBe(RsvpStatus.CONFIRMED);

  // The other guest answers Yes from their own link.
  const yes = await context.newPage();
  await yes.goto(`/attend/${comingToken}?answer=yes`);
  await waitForHydration(yes, "form button");
  await expect(yes.getByRole("radio", { name: "Yes, I'll be there" })).toBeChecked();
  await yes.getByRole("button", { name: "Send my answer" }).click();
  await expect(yes.getByText("Thanks, see you there!")).toBeVisible({ timeout: 20_000 });

  expect(errors).toEqual([]);
  await context.close();
});

test("a bad or unknown link is a real 404 and never indexed", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  for (const path of [`/attend/${"x".repeat(43)}`, "/attend/not-a-token", `/attend/${declinerToken}x`]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.locator("body")).not.toContainText(declinerEmail);
  }
  const robots = await page.request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /attend/");
  await context.close();
});

test("the organiser sees the replies in the Emails card, the People filter and the CSV", async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await ownerPage(browser);

  await page.goto(`${dashboard()}?tab=emails`);
  const status = card(page).getByRole("status");
  await expect(status).toContainText("Asked 2 guests", { timeout: 60_000 });
  const stat = (label: string) => status.locator("div", { has: page.getByText(label, { exact: true }) }).locator("dd");
  await expect(stat("Coming")).toHaveText("1");
  await expect(stat("Not coming")).toHaveText("1");
  await expect(stat("No reply")).toHaveText("0");

  await page.goto(`${dashboard()}?tab=guests&sub=people`);
  await waitForHydration(page, "#guest-search");
  const filter = page.getByRole("combobox", { name: "Attendance confirmation" });
  await expect(filter).toBeVisible();
  await filter.click();
  // Each option carries its server-side count.
  await expect(page.getByRole("option", { name: "Coming (1)", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Not coming (1)", exact: true }).click();
  const exportLink = page.getByRole("link", { name: "Export CSV" });
  await expect(exportLink).toHaveAttribute("href", `/api/exports/events/${eventId}/attendees?attendance=notComing`);
  const list = page.getByRole("list").filter({ hasText: declinerName });
  await expect(list).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(comingName)).toHaveCount(0);
  await expect(list).toContainText("Not coming");
  await expect(list).toContainText(note);

  const csv = await page.request.get((await exportLink.getAttribute("href"))!);
  expect(csv.status()).toBe(200);
  const lines = (await csv.text()).replace(/^﻿/, "").trim().split("\n");
  const header = lines[0]!.split(",");
  expect(header.slice(-2)).toEqual(["Attendance confirmation", "Attendance note"]);
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain(declinerEmail);
  expect(lines[1]).toContain("Not coming");
  expect(lines[1]).toContain(note);
  await context.close();
});

test("with release on, a No shows the released screen and promotes the waitlist", async ({ browser }) => {
  test.setTimeout(90_000);
  // A separate event with one place, so this test never changes the counts above.
  const releaseEventId = (await prisma.event.create({
    data: {
      organisationId,
      title: `Release journey ${suffix}`,
      slug: `release-journey-${suffix}`,
      startDateTime: new Date("2035-02-01T10:00:00.000Z"),
      endDateTime: new Date("2035-02-01T12:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      capacity: 1,
      attendanceCheckReleaseOnDecline: true,
      page: { create: { isPublished: true } },
    },
  })).id;
  // Promotion queues a status email to the waitlisted guest; afterAll discards it.
  testEmails.push(`leave-${suffix}@example.test`, `next-${suffix}@example.test`);
  const leaving = await prisma.rSVP.create({ data: { eventId: releaseEventId, attendeeKey: `guest:leave-${suffix}@example.test`, guestName: "Lee Leaving", guestEmail: `leave-${suffix}@example.test`, status: RsvpStatus.CONFIRMED } });
  const waiting = await prisma.rSVP.create({ data: { eventId: releaseEventId, attendeeKey: `guest:next-${suffix}@example.test`, guestName: "Nia Next", guestEmail: `next-${suffix}@example.test`, status: RsvpStatus.WAITLISTED } });
  // The raw link normally exists only in the email; mint one directly for this test.
  const token = randomBytes(32).toString("base64url");
  await prisma.attendanceCheck.create({ data: { rsvpId: leaving.id, eventId: releaseEventId, tokenHash: createHash("sha256").update(token).digest("hex"), sentAt: new Date() } });

  const context = await newContext(browser);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/attend/${token}?answer=no`);
  await waitForHydration(page, "form button");
  await expect(page.getByText("Answering No releases your place")).toBeVisible();
  await page.getByRole("button", { name: "Release my place" }).click();
  // Regression: the Server Action must not re-render the (now retired) link as a 404.
  await expect(page.getByRole("heading", { name: "Your place has been released" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Your registration" })).toContainText("Lee Leaving");
  await expect(page.getByText("isn’t on the programme")).toHaveCount(0);

  expect(await prisma.rSVP.findUnique({ where: { id: leaving.id } })).toBeNull();
  expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: waiting.id } })).status).toBe(RsvpStatus.CONFIRMED);
  // The retired link is a real 404 on the next visit.
  expect((await page.goto(`/attend/${token}`))?.status()).toBe(404);
  expect(errors).toEqual([]);
  await context.close();
});
