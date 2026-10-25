import { randomUUID } from "node:crypto";
import { EventStatus, PrismaClient, RegistrationMode, RsvpStatus, SoloPolicy, SubmissionStatus } from "@prisma/client";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Public project gallery and results search (docs/HACKATHON.md): search,
// the Award winners filter and sort as shareable URLs, award badges, a
// results count in a live region, a GET form that works without JavaScript,
// canonical URLs without filter params, and a real 404 for a hidden event.
test.describe.configure({ mode: "serial", timeout: 120_000 });

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
const orgSlug = `gallery-${suffix}`;
const eventSlug = `gallery-hack-${suffix}`;
const hiddenSlug = `gallery-hidden-${suffix}`;
const HOUR = 3_600_000;
const PROJECTS = 13;
/** Winners of "Grand prize", places 1..WINNERS, so the results page offers a search. */
const WINNERS = 11;

let organisationId = "";
let ipCounter = 10;

const projectTitle = (index: number) => `Gizmo ${String(index).padStart(2, "0")} ${suffix}`;

async function newPage(browser: Browser, options: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await browser.newContext(options);
  // Its own TEST-NET-2 block, away from the other specs' per-IP limits.
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": `198.51.100.${(ipCounter++ % 40) + 200}` });
  return { context, page: await context.newPage() };
}

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function createEvent(slug: string, status: EventStatus) {
  return prisma.event.create({
    data: {
      organisationId,
      title: `Gallery Hack ${slug}`,
      slug,
      startDateTime: new Date(Date.now() - 48 * HOUR),
      endDateTime: new Date(Date.now() - 24 * HOUR),
      timezone: "UTC",
      status,
      registrationMode: RegistrationMode.TEAM,
      teamMaxSize: 4,
      soloPolicy: SoloPolicy.SOLO_ALLOWED,
      submissionsEnabled: true,
      submissionsOpenAt: new Date(Date.now() - 6 * HOUR),
      submissionsCloseAt: new Date(Date.now() - HOUR),
      projectGalleryPublic: true,
      resultsPublishedAt: new Date(),
      page: { create: { isPublished: status === EventStatus.PUBLISHED } },
    },
  });
}

test.beforeAll(async () => {
  const org = await prisma.organisation.create({ data: { name: `Gallery ${suffix}`, slug: orgSlug } });
  organisationId = org.id;
  const event = await createEvent(eventSlug, EventStatus.PUBLISHED);
  await createEvent(hiddenSlug, EventStatus.DRAFT);
  const award = await prisma.eventAward.create({ data: { eventId: event.id, name: "Grand prize", position: 0 } });
  const design = await prisma.eventAward.create({ data: { eventId: event.id, name: "Best design", position: 1 } });
  for (let index = 1; index <= PROJECTS; index++) {
    // Project 1 is a team; the rest are solo entrants. Later index = submitted later.
    let entrant: { teamId?: string; rsvpId?: string };
    if (index === 1) {
      const team = await prisma.team.create({
        data: { eventId: event.id, name: `Robot Wranglers ${suffix}`, nameKey: `robot wranglers ${suffix}`, status: RsvpStatus.CONFIRMED, joinToken: randomUUID(), manageTokenHash: randomUUID() },
      });
      await prisma.rSVP.create({
        data: { eventId: event.id, teamId: team.id, guestName: "Lead Person", guestEmail: `gallery-lead-${suffix}@example.test`, attendeeKey: `guest:gallery-lead-${suffix}@example.test`, status: RsvpStatus.CONFIRMED },
      });
      entrant = { teamId: team.id };
    } else {
      const email = `gallery-${index}-${suffix}@example.test`;
      const rsvp = await prisma.rSVP.create({
        data: { eventId: event.id, guestName: `Entrant${index} Surname`, guestEmail: email, attendeeKey: `guest:${email}`, status: RsvpStatus.CONFIRMED },
      });
      entrant = { rsvpId: rsvp.id };
    }
    const submission = await prisma.submission.create({
      data: { eventId: event.id, ...entrant, title: projectTitle(index), summary: `Summary ${index}`, status: SubmissionStatus.SUBMITTED, submittedAt: new Date(Date.now() - 5 * HOUR + index * 60_000) },
    });
    // Grand prize: project 13 wins 1st, 12 wins 2nd, …; project 1 wins Best design.
    if (index > PROJECTS - WINNERS) await prisma.eventAwardWinner.create({ data: { awardId: award.id, submissionId: submission.id, place: PROJECTS - index + 1 } });
    if (index === 1) await prisma.eventAwardWinner.create({ data: { awardId: design.id, submissionId: submission.id, place: 1 } });
  }
});

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.deleteMany({ where: { id: organisationId } });
  await prisma.$disconnect();
});

const galleryPath = `/${orgSlug}/${eventSlug}/projects`;
const cardTitles = (page: Page) => page.getByRole("article").getByRole("heading", { level: 2 }).allTextContents();

test("search, filter and sort the gallery with shareable URLs", async ({ browser }) => {
  const { context, page } = await newPage(browser);
  const errors = collectPageErrors(page);
  await page.goto(galleryPath);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  // Newest first by default; canonical has no filter params.
  expect((await cardTitles(page))[0]).toBe(projectTitle(PROJECTS));
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${galleryPath}$`));
  const status = page.getByRole("status").filter({ hasText: "projects" });
  await expect(status).toHaveText(`${PROJECTS} projects`);
  await expect(status).toHaveAttribute("aria-live", "polite");

  // Search: labelled field, submit button, server-side, count announced.
  const search = page.getByRole("searchbox", { name: "Search projects or teams" });
  await search.fill("robot wranglers");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\?q=robot\+wranglers$/);
  await expect(page.getByRole("status").filter({ hasText: "matching" })).toHaveText("1 matching project");
  expect(await cardTitles(page)).toEqual([projectTitle(1)]);
  // Award badges on the card; no surnames or emails anywhere.
  await expect(page.getByRole("article").getByRole("list", { name: "Awards" })).toContainText("Best design · 1st place");
  await expect(page.locator("body")).not.toContainText("Surname");
  await expect(page.locator("body")).not.toContainText("@example.test");
  // Search is not indexed; canonical is the plain gallery.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${galleryPath}$`));
  await page.getByRole("link", { name: "Clear search" }).click();
  await expect(page).toHaveURL(new RegExp(`${galleryPath}$`));

  // Award winners filter, then Awards first.
  const filters = page.getByRole("navigation", { name: "Filter projects" });
  await filters.getByRole("link", { name: `Award winners (${WINNERS + 1})` }).click();
  await expect(page).toHaveURL(/\?filter=winners$/);
  await expect(filters.getByRole("link", { name: /Award winners/ })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("status").filter({ hasText: "matching" })).toHaveText(`${WINNERS + 1} matching projects`);
  await page.getByRole("navigation", { name: "Sort projects" }).getByRole("link", { name: "Awards first" }).click();
  await expect(page).toHaveURL(/\?filter=winners&sort=awards$/);
  const titles = await cardTitles(page);
  expect(titles.slice(0, 3)).toEqual([projectTitle(13), projectTitle(12), projectTitle(11)]);
  // Project 1 only won the second award, so it comes after every Grand prize winner.
  expect(titles.at(-1)).toBe(projectTitle(1));

  // A–Z keeps the filter; search keeps both through hidden fields.
  await page.getByRole("navigation", { name: "Sort projects" }).getByRole("link", { name: "A–Z" }).click();
  await expect(page).toHaveURL(/\?filter=winners&sort=az$/);
  expect((await cardTitles(page))[0]).toBe(projectTitle(1));
  await page.getByRole("searchbox", { name: "Search projects or teams" }).fill("Gizmo 13");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/filter=winners/);
  await expect(page).toHaveURL(/sort=az/);
  expect(await cardTitles(page)).toEqual([projectTitle(13)]);
  expect(errors).toEqual([]);
  await context.close();
});

test("invalid params fall back to the defaults and pages keep the view", async ({ browser }) => {
  const { context, page } = await newPage(browser);
  await page.goto(`${galleryPath}?filter=losers&sort=score&page=abc`);
  expect((await cardTitles(page))[0]).toBe(projectTitle(PROJECTS));
  await expect(page.getByRole("navigation", { name: "Sort projects" }).getByRole("link", { name: "Newest" })).toHaveAttribute("aria-current", "true");
  // Page past the end redirects to the last page, keeping the filter and sort.
  await page.goto(`${galleryPath}?sort=az&page=99`);
  await expect(page).toHaveURL(new RegExp(`${galleryPath}\\?sort=az$`));
  await context.close();
});

test("the GET form works without JavaScript", async ({ browser }) => {
  const { context, page } = await newPage(browser, { javaScriptEnabled: false });
  await page.goto(`${galleryPath}?sort=awards`);
  await page.getByRole("searchbox", { name: "Search projects or teams" }).fill("Gizmo 0");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/sort=awards/);
  await expect(page).toHaveURL(/q=Gizmo\+0/);
  const titles = await cardTitles(page);
  // Projects 1–9 match; Grand prize winners (3–9, best place first) lead.
  expect(titles).toHaveLength(9);
  expect(titles[0]).toBe(projectTitle(9));
  await context.close();
});

test("results page offers a search when it lists many winners", async ({ browser }) => {
  const { context, page } = await newPage(browser);
  await page.goto(`/${orgSlug}/${eventSlug}/results`);
  await expect(page.getByRole("status").filter({ hasText: "winners" })).toHaveText(`${WINNERS + 1} winners`);
  await page.getByRole("searchbox", { name: "Search winning projects or teams" }).fill("robot");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/results\?q=robot$/);
  await expect(page.getByRole("status").filter({ hasText: "match" })).toHaveText(`1 of ${WINNERS + 1} winners match`);
  await expect(page.getByRole("heading", { level: 2, name: "Best design" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Grand prize" })).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/results$/);
  await context.close();
});

test("a hidden event's gallery is a real 404 whatever the params", async ({ browser }) => {
  const { context, page } = await newPage(browser);
  for (const path of [`/${orgSlug}/${hiddenSlug}/projects`, `/${orgSlug}/${hiddenSlug}/projects?filter=winners&sort=awards&q=x`, `/${orgSlug}/${hiddenSlug}/results?q=x`]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
  await context.close();
});
