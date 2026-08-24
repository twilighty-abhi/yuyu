import { randomUUID } from "node:crypto";
import { EventPrivacyType, EventStatus, PrismaClient, RsvpStatus } from "@prisma/client";
import { expect, test } from "@playwright/test";

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "");
let organisationId: string;
let ticketToken: string;
let waitlistedToken: string;

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

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download ticket" }).click();
  expect((await download).suggestedFilename()).toBe("downloadable-ticket-test-ticket.svg");
  expect(browserErrors, browserErrors.join("\n")).toEqual([]);
});

test("a waitlisted attendee cannot obtain a scannable ticket", async ({ page, request }) => {
  await page.goto(`/ticket/${waitlistedToken}`);
  await expect(page.getByText("available after this registration is confirmed")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download ticket" })).toHaveCount(0);
  expect((await request.get(`/api/ticket/${waitlistedToken}/download`)).status()).toBe(404);
});
