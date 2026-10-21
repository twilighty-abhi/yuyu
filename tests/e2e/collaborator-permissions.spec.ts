import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPermission, EventPrivacyType, EventStatus, PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

/*
 * Co-organisers see the controls for the grants they hold and never the
 * owner/admin-only ones (docs/PERMISSIONS.md). Both collaborators are
 * non-members of the organisation, as an invited co-organiser usually is.
 */

test.describe.configure({ mode: "serial" });
const prisma = new PrismaClient();
const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `collab-perms-${suffix}`;
const password = "collaborator-browser-password";
const checkInEmail = `collab-checkin-${suffix}@example.test`;
const fullEmail = `collab-full-${suffix}@example.test`;
let organisationId = "";
let eventId = "";
const userIds: string[] = [];

test.beforeAll(async () => {
  organisationId = (await prisma.organisation.create({ data: { name: `Co-organisers ${suffix}`, slug: orgSlug } })).id;
  const event = await prisma.event.create({
    data: {
      organisationId,
      title: `Co-organised ${suffix}`,
      slug: `co-organised-${suffix}`,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-01T12:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.DRAFT,
      privacyType: EventPrivacyType.PUBLIC,
      page: { create: { isPublished: false } },
    },
  });
  eventId = event.id;
  const passwordHash = await bcrypt.hash(password, 12);
  for (const [email, permissions] of [
    [checkInEmail, [EventPermission.CHECK_IN]],
    [fullEmail, Object.values(EventPermission)],
  ] as const) {
    const user = await prisma.user.create({ data: { email, name: "Co-organiser", passwordHash, emailVerified: new Date() } });
    userIds.push(user.id);
    await prisma.eventCollaborator.create({ data: { eventId, userId: user.id, permissions: [...permissions] } });
  }
});

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

async function signIn(page: Page, email: string, ip: string) {
  await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": ip });
  // Settle the Auth.js CSRF cookie before the login page's parallel requests.
  await page.request.get("/api/auth/csrf");
  await page.goto("/login?callbackUrl=%2Fdashboard");
  await page.getByRole("textbox", { name: /^Email/ }).fill(email);
  await page.locator('input[type="password"]:visible').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Opens one dashboard tab (and sub-tab) by deep link and waits for it to be selected. */
async function openTab(page: Page, tab: string, label: string, sub?: string) {
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}?tab=${tab}${sub ? `&sub=${sub}` : ""}`);
  await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
  return page.getByRole("tabpanel", { name: label, exact: true });
}

async function expectNoOwnerControls(page: Page) {
  const settings = await openTab(page, "settings", "Settings");
  await expect(settings.getByText(/Only organisation owners and admins can change this event/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delete event" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Delete event/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clone event" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Put it on your website" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Event address" })).toHaveCount(0);

  const overview = await openTab(page, "overview", "Overview");
  await expect(overview.getByRole("heading", { name: "Share" })).toBeVisible();
  await expect(overview.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await expect(overview.getByRole("button", { name: "Create short link" })).toHaveCount(0);
  await expect(overview.getByRole("button", { name: /Embed/ })).toHaveCount(0);
}

test("a CHECK_IN-only co-organiser gets the check-in desk and nothing owner-only", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, checkInEmail, "192.0.2.231");
  await expectNoOwnerControls(page);

  const checkIn = await openTab(page, "check-in", "Check-in");
  await expect(checkIn.getByRole("heading", { name: "Check-in desk" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open check-in" }).first()).toBeVisible();

  const people = await openTab(page, "guests", "Guests", "people");
  await expect(people.getByText("You do not have permission to view or manage attendee registrations.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add guest" })).toHaveCount(0);
  const invites = await openTab(page, "guests", "Guests", "invites");
  await expect(invites.getByText("You do not have permission to manage invitations for this event.")).toBeVisible();
  const content = await openTab(page, "page", "Event page", "page");
  await expect(content.getByText("You do not have permission to edit the event page.")).toBeVisible();
  await expect(content.getByRole("link", { name: "Open schedule" })).toHaveCount(0);
});

test("a co-organiser with every grant reaches each grant's controls but no owner-only ones", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, fullEmail, "192.0.2.232");
  await expectNoOwnerControls(page);

  // MANAGE_REGISTRATIONS: the guest list and its tools.
  const people = await openTab(page, "guests", "Guests", "people");
  await expect(people.getByRole("button", { name: "Add guest" })).toBeVisible();
  await expect(people.getByRole("link", { name: "Download CSV" })).toBeVisible();
  // MANAGE_INVITATIONS: the invite list.
  const invites = await openTab(page, "guests", "Guests", "invites");
  await expect(invites.getByRole("heading", { name: "Invites" })).toBeVisible();
  await expect(invites.getByText(/do not have permission/)).toHaveCount(0);
  // EDIT_DETAILS: event page content; PUBLISH_AND_SCHEDULE: the programme schedule.
  const content = await openTab(page, "page", "Event page", "page");
  await expect(content.getByRole("heading", { name: "Sections" })).toBeVisible();
  await expect(content.getByRole("link", { name: "Open schedule" }).first()).toBeVisible();
  // CHECK_IN: the desk.
  const checkIn = await openTab(page, "check-in", "Check-in");
  await expect(checkIn.getByRole("heading", { name: "Check-in desk" })).toBeVisible();
  await expect(checkIn.getByRole("link", { name: "Export attendance" })).toBeVisible();
  // Owner/admin-only tabs stay closed.
  const emails = await openTab(page, "emails", "Emails");
  await expect(emails.getByText("You do not have permission to email attendees.")).toBeVisible();
  const feedback = await openTab(page, "feedback", "Feedback");
  await expect(feedback.getByText("You do not have permission to manage feedback for this event.")).toBeVisible();

  // The server agrees: the schedule page opens and the attendee export is served.
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}/schedule`);
  await expect(page.getByRole("heading", { name: "Programme schedule" })).toBeVisible();
  const csv = await page.request.get(`/api/exports/events/${eventId}/attendees`);
  expect(csv.status()).toBe(200);
});
