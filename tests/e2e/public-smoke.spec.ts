import { randomUUID } from "node:crypto";
import { EventPrivacyType, EventStatus, PrismaClient, RsvpStatus } from "@prisma/client";
import { expect, test } from "@playwright/test";
import sharp from "sharp";

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "");
let organisationId: string;
let ticketToken: string;
let waitlistedToken: string;
let feedbackEmail: string;
let feedbackFormId: string;

test.beforeAll(async () => {
  const organisation = await prisma.organisation.create({
    data: { name: `E2E Test ${suffix}`, slug: `e2e-test-${suffix}` },
  });
  organisationId = organisation.id;
  const event = await prisma.event.create({
    data: {
      organisationId,
      title: "Downloadable ticket test",
      slug: `download-ticket-${suffix}`,
      startDateTime: new Date("2030-01-01T10:00:00.000Z"),
      endDateTime: new Date("2030-01-01T11:00:00.000Z"),
      timezone: "UTC",
      location: "Test venue",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
    },
  });
  const rsvp = await prisma.rSVP.create({
    data: {
      eventId: event.id,
      attendeeKey: `e2e:${suffix}`,
      guestEmail: `ticket-${suffix}@example.test`,
      guestName: "Ticket Download Test",
      status: RsvpStatus.CONFIRMED,
    },
  });
  ticketToken = rsvp.checkInToken;
  feedbackEmail = rsvp.guestEmail!;
  const feedbackForm = await prisma.eventFeedbackForm.create({
    data: { eventId: event.id, isOpen: true, title: "Tell us what you thought", certificateEnabled: true },
  });
  feedbackFormId = feedbackForm.id;
  await prisma.eventFeedbackField.create({
    data: {
      formId: feedbackForm.id,
      key: "comment",
      label: "Your feedback",
      type: "TEXTAREA",
      required: true,
      sortOrder: 1,
    },
  });
  const waitlisted = await prisma.rSVP.create({
    data: {
      eventId: event.id,
      attendeeKey: `e2e-waitlisted:${suffix}`,
      guestEmail: `waitlisted-${suffix}@example.test`,
      guestName: "Waitlisted Test",
      status: RsvpStatus.WAITLISTED,
    },
  });
  waitlistedToken = waitlisted.checkInToken;
});

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  await prisma.$disconnect();
});

test("public health endpoint is available", async ({ request }) => {
  const response = await request.get("/api/health");
  await expect(response).toBeOK();
  await expect(response.json()).resolves.toMatchObject({ ok: true });
});

test("Auth.js session polling is not treated as repeated sign-in attempts", async ({ request }) => {
  const responses = await Promise.all(
    Array.from({ length: 12 }, () => request.get("/api/auth/session")),
  );
  expect(responses.map((response) => response.status())).toEqual(
    Array.from({ length: 12 }, () => 200),
  );
});

test("mobile navigation uses a compact touch-friendly menu", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");

  const menuButton = page.getByRole("button", { name: "Open navigation menu" });
  await expect(menuButton).toBeVisible();
  const bounds = await menuButton.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);

  await menuButton.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds?.height).toBeLessThan(280);
  await page.getByRole("menuitem", { name: "Discover" }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveAttribute("aria-expanded", "false");
});

test("login and crawler controls render", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Get started now" })).toBeVisible();

  const robots = await page.request.get("/robots.txt");
  await expect(robots).toBeOK();
  await expect(robots.text()).resolves.toContain("Disallow: /ticket/");
  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

test("a confirmed attendee can download a QR ticket", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(`/ticket/${ticketToken}`);
  await expect(page.getByRole("heading", { name: "Downloadable ticket test" })).toBeVisible();
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
  await expect(page.getByText(/Ticket link:/)).toHaveCount(0);

  const ticketResponse = await page.request.get(`/api/ticket/${ticketToken}/download`);
  expect(ticketResponse.headers()["content-type"]).toBe("image/jpeg");
  expect(ticketResponse.headers()["cache-control"]).toContain("no-store");
  expect(ticketResponse.headers()["referrer-policy"]).toBe("no-referrer");
  const ticketBytes = await ticketResponse.body();
  expect(Array.from(ticketBytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  const { data: pixels } = await sharp(ticketBytes).raw().toBuffer({ resolveWithObject: true });
  expect([...pixels.subarray(0, 3)].every((channel) => channel >= 250)).toBe(true);

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download ticket" }).click();
  expect((await download).suggestedFilename()).toBe("downloadable-ticket-test-ticket.jpg");
  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

test("a waitlisted attendee cannot obtain a scannable ticket", async ({ page, request }) => {
  await page.goto(`/ticket/${waitlistedToken}`);
  const main = page.locator("#main-content");
  await expect(main.getByText("available after this registration is confirmed")).toBeVisible();
  await expect(main.getByRole("link", { name: "Download ticket" })).toHaveCount(0);
  expect((await request.get(`/api/ticket/${waitlistedToken}/download`)).status()).toBe(404);
});

test("a confirmed attendee can submit feedback and download a white JPEG certificate", async ({ page, request }) => {
  await page.goto(`/e2e-test-${suffix}/download-ticket-${suffix}/feedback`);
  const main = page.locator("#main-content");
  await expect(main.getByRole("heading", { name: "Tell us what you thought" })).toBeVisible();
  await main.getByLabel("Registered email").fill(feedbackEmail);
  await main.getByLabel("Your feedback").fill("Very useful event.");
  await main.getByRole("button", { name: "Submit feedback & get certificate" }).click();
  const certificate = main.getByRole("link", { name: "Download certificate (JPG)" });
  await expect(certificate).toBeVisible();
  const href = await certificate.getAttribute("href");
  expect(href).toMatch(/^\/api\/feedback\/certificate\//);
  const response = await request.get(href!);
  expect(response.headers()["content-type"]).toBe("image/jpeg");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  const bytes = await response.body();
  expect(Array.from(bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  const { data: pixels } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  expect([...pixels.subarray(0, 3)].every((channel) => channel >= 250)).toBe(true);
  await prisma.eventFeedbackForm.update({ where: { id: feedbackFormId }, data: { certificateEnabled: false } });
  await expect(await request.get(href!)).toBeOK();
  expect((await request.get("/api/feedback/certificate/not-valid!")).status()).toBe(404);
});
