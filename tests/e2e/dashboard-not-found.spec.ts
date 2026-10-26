import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPermission, EventPrivacyType, EventStatus, MembershipRole, PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

/*
 * Dashboard refusals are real HTTP statuses, not a streamed 200 carrying the
 * not-found page or a client-side redirect. A loading.tsx above a page used to
 * start the stream before the page's notFound()/redirect() ran
 * (lib/dashboardGuards.ts, tests/unit/dashboard-loading-boundaries.test.ts).
 */

test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const password = "dashboard-not-found-password";
const ownerEmail = `nf-owner-${suffix}@example.test`;
const memberEmail = `nf-member-${suffix}@example.test`;
const judgeEmail = `nf-judge-${suffix}@example.test`;
const orgSlug = `nf-org-${suffix}`;
const otherOrgSlug = `nf-other-${suffix}`;
const eventTitle = `Judged Event ${suffix}`;
const siblingTitle = `Sibling Event ${suffix}`;
const otherTitle = `Other Org Event ${suffix}`;
const unknownId = `missing-${suffix}`;

let organisationId = "";
let otherOrganisationId = "";
let eventId = "";
let siblingEventId = "";
let otherEventId = "";
let seriesId = "";
const userIds: string[] = [];
let ipCounter = 10;

function eventData(organisationId: string, title: string, slug: string) {
  return {
    organisationId,
    title,
    slug,
    startDateTime: new Date("2035-03-01T10:00:00.000Z"),
    endDateTime: new Date("2035-03-01T12:00:00.000Z"),
    timezone: "UTC",
    status: EventStatus.DRAFT,
    privacyType: EventPrivacyType.PUBLIC,
    page: { create: { isPublished: false } },
  };
}

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(password, 12);
  const [owner, member, judge] = await Promise.all(
    [ownerEmail, memberEmail, judgeEmail].map((email) => prisma.user.create({ data: { email, name: "Not Found Tester", passwordHash, emailVerified: new Date() } })),
  );
  userIds.push(owner.id, member.id, judge.id);
  organisationId = (await prisma.organisation.create({ data: { name: `Not Found ${suffix}`, slug: orgSlug } })).id;
  otherOrganisationId = (await prisma.organisation.create({ data: { name: `Elsewhere ${suffix}`, slug: otherOrgSlug } })).id;
  await prisma.membership.createMany({
    data: [
      { userId: owner.id, organisationId, role: MembershipRole.OWNER },
      { userId: member.id, organisationId, role: MembershipRole.MEMBER },
    ],
  });
  eventId = (await prisma.event.create({ data: eventData(organisationId, eventTitle, `nf-event-${suffix}`) })).id;
  siblingEventId = (await prisma.event.create({ data: eventData(organisationId, siblingTitle, `nf-sibling-${suffix}`) })).id;
  otherEventId = (await prisma.event.create({ data: eventData(otherOrganisationId, otherTitle, `nf-other-${suffix}`) })).id;
  seriesId = (await prisma.eventSeries.create({ data: { organisationId: otherOrganisationId, title: `Other Series ${suffix}`, slug: `nf-series-${suffix}`, recurrenceRule: "FREQ=WEEKLY;COUNT=2", timezone: "UTC" } })).id;
  await prisma.eventCollaborator.create({ data: { eventId, userId: judge.id, permissions: [EventPermission.JUDGE] } });
});

test.afterAll(async () => {
  const organisations = [organisationId, otherOrganisationId].filter(Boolean);
  if (organisations.length) await prisma.organisation.deleteMany({ where: { id: { in: organisations } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

async function newContext(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  // Its own benchmarking range so the per-IP sign-in limit is not shared with other specs.
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.18.40.${(ipCounter++ % 240) + 10}` });
  return context;
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

async function signedInRequest(browser: Browser, email: string): Promise<{ context: BrowserContext; request: APIRequestContext }> {
  if (!sessions.has(email)) {
    const signInContext = await newContext(browser);
    await signIn(await signInContext.newPage(), email);
    sessions.set(email, await signInContext.storageState());
    await signInContext.close();
  }
  const context = await newContext(browser, { storageState: sessions.get(email) });
  return { context, request: context.request };
}

/** A document request as a browser makes it, without following redirects. */
async function fetchPage(request: APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0, headers: { accept: "text/html" } });
  return { status: response.status(), location: response.headers()["location"] ?? "", body: await response.text() };
}

async function expectNotFound(request: APIRequestContext, path: string, hidden: string[] = []) {
  const { status, body } = await fetchPage(request, path);
  expect(status, path).toBe(404);
  // The refusal is the not-found page itself, never the protected page streamed first.
  for (const text of hidden) expect(body, path).not.toContain(text);
}

async function expectRedirect(request: APIRequestContext, path: string, target: RegExp) {
  const { status, location } = await fetchPage(request, path);
  expect(status, path).toBe(307);
  expect(new URL(location, "http://yuyu.test").pathname, path).toMatch(target);
}

async function expectOk(request: APIRequestContext, path: string, text?: string) {
  const { status, body } = await fetchPage(request, path);
  expect(status, path).toBe(200);
  if (text) expect(body, path).toContain(text);
}

test("unauthenticated dashboard requests redirect to sign-in", async ({ browser }) => {
  const context = await newContext(browser);
  for (const path of [`/dashboard`, `/dashboard/${orgSlug}`, `/dashboard/${orgSlug}/event/${eventId}`, `/dashboard/${orgSlug}/event/${eventId}/check-in`]) {
    await expectRedirect(context.request, path, /^\/login$/);
  }
  await context.close();
});

test("an owner gets 200 for their own pages and real 404/307 for everything else", async ({ browser }) => {
  const { context, request } = await signedInRequest(browser, ownerEmail);
  await expectOk(request, `/dashboard`);
  await expectOk(request, `/dashboard/${orgSlug}`);
  await expectOk(request, `/dashboard/${orgSlug}/event/${eventId}`, eventTitle);
  await expectOk(request, `/dashboard/${orgSlug}/event/${eventId}/check-in`, eventTitle);
  await expectOk(request, `/dashboard/${orgSlug}/event/${eventId}/schedule`, eventTitle);
  await expectOk(request, `/dashboard/${orgSlug}/members`);
  await expectOk(request, `/dashboard/${orgSlug}/settings`);
  await expectOk(request, `/dashboard/${orgSlug}/settings/api`);
  await expectOk(request, `/dashboard/${orgSlug}/settings/webhooks`);

  // Another organisation's event or series, through this organisation's URL.
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${otherEventId}`, [otherTitle]);
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${otherEventId}/check-in`, [otherTitle]);
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${otherEventId}/schedule`, [otherTitle]);
  await expectNotFound(request, `/dashboard/${orgSlug}/series/${seriesId}`);
  // Unknown ids.
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${unknownId}`);
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${unknownId}/check-in`);
  await expectNotFound(request, `/dashboard/${orgSlug}/series/${unknownId}`);
  await expectNotFound(request, `/dashboard/${orgSlug}/settings/webhooks/${unknownId}`);
  // An organisation they do not belong to, and one that does not exist.
  await expectRedirect(request, `/dashboard/${otherOrgSlug}`, /^\/dashboard$/);
  await expectRedirect(request, `/dashboard/${otherOrgSlug}/event/${otherEventId}`, /^\/dashboard$/);
  await expectRedirect(request, `/dashboard/${otherOrgSlug}/event/${otherEventId}/check-in`, /^\/dashboard$/);
  await expectRedirect(request, `/dashboard/nf-missing-${suffix}/members`, /^\/dashboard$/);
  await context.close();
});

test("a plain member is sent back from admin settings with a real redirect", async ({ browser }) => {
  const { context, request } = await signedInRequest(browser, memberEmail);
  await expectOk(request, `/dashboard/${orgSlug}/members`);
  await expectRedirect(request, `/dashboard/${orgSlug}/settings`, new RegExp(`^/dashboard/${orgSlug}$`));
  await expectRedirect(request, `/dashboard/${orgSlug}/settings/api`, new RegExp(`^/dashboard/${orgSlug}$`));
  await expectRedirect(request, `/dashboard/${orgSlug}/settings/webhooks`, new RegExp(`^/dashboard/${orgSlug}$`));
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${eventId}/check-in`, [eventTitle]);
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${eventId}/schedule`, [eventTitle]);
  await context.close();
});

test("a JUDGE-only collaborator gets real 404s outside their judging workspace", async ({ browser }) => {
  const { context, request } = await signedInRequest(browser, judgeEmail);
  await expectOk(request, `/dashboard/${orgSlug}`);
  await expectOk(request, `/dashboard/${orgSlug}/event/${eventId}`, eventTitle);

  await expectNotFound(request, `/dashboard/${orgSlug}/event/${eventId}/check-in`, [eventTitle]);
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${eventId}/schedule`, [eventTitle]);
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${siblingEventId}`, [siblingTitle]);
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${siblingEventId}/check-in`, [siblingTitle]);
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${otherEventId}`, [otherTitle]);
  await expectNotFound(request, `/dashboard/${orgSlug}/event/${unknownId}`);
  await expectRedirect(request, `/dashboard/${orgSlug}/members`, /^\/dashboard$/);
  await expectRedirect(request, `/dashboard/${orgSlug}/settings`, /^\/dashboard$/);
  await expectRedirect(request, `/dashboard/${otherOrgSlug}`, /^\/dashboard$/);
  await context.close();
});
