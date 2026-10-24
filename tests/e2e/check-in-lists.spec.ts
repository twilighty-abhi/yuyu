import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPermission, EventPrivacyType, EventStatus, MembershipRole, PrismaClient, RsvpStatus } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

/*
 * Custom check-in lists: an admin creates "Swag", checks a confirmed guest in
 * by search, sees the count, gets "already" on a second scan, undoes it, and
 * entry check-in still works on its own. A CHECK_IN-only co-organiser can
 * scan into the list but cannot manage lists.
 */

test.describe.configure({ mode: "serial" });
const prisma = new PrismaClient();
const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `check-in-lists-${suffix}`;
const password = "check-in-lists-browser-password";
const adminEmail = `lists-admin-${suffix}@example.test`;
const checkerEmail = `lists-checker-${suffix}@example.test`;
const guestName = `Ada Swag ${suffix.slice(0, 8)}`;
const secondGuestName = `Grace Swag ${suffix.slice(0, 8)}`;
let organisationId = "";
let eventId = "";
let guest: { id: string; checkInToken: string };
let secondGuest: { id: string; checkInToken: string };
const userIds: string[] = [];

// A random documentation-range client IP per run, so per-IP limits never couple runs.
const randomIp = () => `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;

test.beforeAll(async () => {
  organisationId = (await prisma.organisation.create({ data: { name: `Check-in lists ${suffix}`, slug: orgSlug } })).id;
  eventId = (await prisma.event.create({
    data: {
      organisationId,
      title: `Lists event ${suffix}`,
      slug: `lists-event-${suffix}`,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-01T18:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      page: { create: { isPublished: true } },
    },
  })).id;
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.create({ data: { email: adminEmail, name: "Lists admin", passwordHash, emailVerified: new Date(), memberships: { create: { organisationId, role: MembershipRole.OWNER } } } });
  const checker = await prisma.user.create({ data: { email: checkerEmail, name: "Lists checker", passwordHash, emailVerified: new Date() } });
  userIds.push(admin.id, checker.id);
  await prisma.eventCollaborator.create({ data: { eventId, userId: checker.id, permissions: [EventPermission.CHECK_IN] } });
  for (const [name, assign] of [[guestName, (row: typeof guest) => { guest = row; }], [secondGuestName, (row: typeof guest) => { secondGuest = row; }]] as const) {
    const email = `${name.toLowerCase().replaceAll(" ", "-")}@example.test`;
    assign(await prisma.rSVP.create({
      data: { eventId, attendeeKey: `guest:${email}`, guestEmail: email, guestName: name, status: RsvpStatus.CONFIRMED },
      select: { id: true, checkInToken: true },
    }));
  }
});

test.afterAll(async () => {
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

async function signIn(page: Page, email: string) {
  await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": randomIp() });
  await page.request.get("/api/auth/csrf");
  await page.goto("/login?callbackUrl=%2Fdashboard");
  await page.getByRole("textbox", { name: /^Email/ }).fill(email);
  await page.locator('input[type="password"]:visible').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * While a streamed dashboard page settles, React can briefly keep a hidden
 * copy of the server markup; role queries skip it, test ids need the filter.
 */
const visible = (page: Page, testId: string) => page.getByTestId(testId).filter({ visible: true });

async function openCheckInTab(page: Page) {
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}?tab=check-in`);
  await expect(page.getByRole("tab", { name: "Check-in", exact: true })).toHaveAttribute("aria-selected", "true");
  return page.getByRole("tabpanel", { name: "Check-in", exact: true });
}

test("an admin creates a Swag list, checks a guest in, sees already, undoes, and entry stays separate", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, adminEmail);

  const panel = await openCheckInTab(page);
  await panel.getByRole("button", { name: "Manage lists" }).click();
  const dialog = page.getByRole("dialog", { name: "Check-in lists" });
  await dialog.getByLabel("New list").fill("Swag");
  await dialog.getByRole("button", { name: "Add list" }).click();
  await expect(dialog.getByRole("list", { name: "Open lists" }).getByRole("textbox")).toHaveValue("Swag");
  await dialog.getByRole("button", { name: "Done" }).click();

  const lists = panel.getByRole("list", { name: "Check-in lists" });
  await expect(lists).toContainText("Swag");
  await expect(lists).toContainText("0 / 2 collected");
  await lists.getByRole("link", { name: "Open Swag check-in" }).click();
  await expect(page).toHaveURL(/\/check-in\?list=/);
  await expect(page.getByRole("link", { name: /^Swag/ })).toHaveAttribute("aria-current", "page");

  // Search and check in.
  await page.getByRole("textbox", { name: "Name or email", exact: true }).fill(guestName);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: `Check ${guestName} in to Swag` }).first().click();
  const result = visible(page, "list-result");
  await expect(result).toContainText(/Checked in to Swag at \d{1,2}:\d{2} (AM|PM)/);
  await expect(result).toContainText(guestName);
  await expect(visible(page, "list-count")).toContainText("1 / 2 collected");

  // A second attempt (typed ticket code) says "already".
  await page.getByRole("textbox", { name: "Ticket URL or code" }).fill(guest.checkInToken);
  await page.getByRole("button", { name: "Check in to Swag", exact: true }).click();
  await expect(result).toContainText(/Already checked in to Swag at \d{1,2}:\d{2} (AM|PM)/);
  await expect(visible(page, "list-count")).toContainText("1 / 2 collected");

  // Undo.
  await result.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(`${guestName} removed from Swag`)).toBeVisible();
  await expect(visible(page, "list-count")).toContainText("0 / 2 collected");
  await expect.poll(() => prisma.checkInListRecord.count({ where: { rsvpId: guest.id } })).toBe(0);
  await expect.poll(() => prisma.checkInListEvent.count({ where: { rsvpId: guest.id } })).toBe(2);

  // The guest view filters by collected state.
  const roster = page.getByRole("list", { name: "Guests for Swag" });
  await page.getByRole("button", { name: /^Not collected/ }).click();
  await expect(roster.getByText(guestName)).toBeVisible();
  await page.getByRole("button", { name: /^Collected/ }).click();
  await expect(page.getByText("No guests match this filter.")).toBeVisible();

  // Entry is untouched by all of that, and still works on its own.
  expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: guest.id } })).checkedInAt).toBeNull();
  await page.getByRole("link", { name: "Entry", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Check-in desk" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name or email", exact: true }).fill(guestName);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Check in", exact: true }).first().click();
  await page.getByRole("dialog", { name: "Confirm check-in" }).getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Checked in" }).first()).toBeVisible();
  await expect.poll(async () => (await prisma.rSVP.findUniqueOrThrow({ where: { id: guest.id } })).checkedInAt !== null).toBe(true);
  await expect.poll(() => prisma.checkInListRecord.count({ where: { rsvpId: guest.id } })).toBe(0);
});

test("a CHECK_IN-only co-organiser scans into the list but cannot manage lists", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, checkerEmail);
  const list = await prisma.checkInList.findFirstOrThrow({ where: { eventId, name: "Swag" } });

  const panel = await openCheckInTab(page);
  await expect(panel.getByRole("list", { name: "Check-in lists" })).toContainText("Swag");
  await expect(page.getByRole("button", { name: "Manage lists" })).toHaveCount(0);

  await page.goto(`/dashboard/${orgSlug}/event/${eventId}/check-in?list=${list.id}`);
  await expect(page.getByRole("heading", { name: "Swag", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Manage lists" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Ticket URL or code" }).fill(`http://127.0.0.1/ticket/${secondGuest.checkInToken}`);
  await page.getByRole("button", { name: "Check in to Swag", exact: true }).click();
  await expect(visible(page, "list-result")).toContainText("Checked in to Swag");
  await expect(visible(page, "list-result")).toContainText(secondGuestName);
  await expect(visible(page, "list-count")).toContainText("1 / 2 collected");
  await expect.poll(() => prisma.checkInListRecord.count({ where: { listId: list.id, rsvpId: secondGuest.id } })).toBe(1);
  expect((await prisma.rSVP.findUniqueOrThrow({ where: { id: secondGuest.id } })).checkedInAt).toBeNull();
});
