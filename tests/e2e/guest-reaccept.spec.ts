import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPrivacyType, EventStatus, MembershipRole, PrismaClient, RsvpStatus } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
const prisma = new PrismaClient();
const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
const orgSlug = `reaccept-${suffix}`;
const password = "reaccept-browser-password";
const ownerEmail = `reaccept-owner-${suffix}@example.test`;
const roomGuest = { name: "Asha Room", email: `reaccept-room-${suffix}@example.test` };
const fullGuest = { name: "Bram Full", email: `reaccept-full-${suffix}@example.test` };
let organisationId = "";
let eventId = "";
let ownerId = "";

test.beforeAll(async () => {
  const organisation = await prisma.organisation.create({ data: { name: `Reaccept ${suffix}`, slug: orgSlug } });
  organisationId = organisation.id;
  const event = await prisma.event.create({ data: {
    organisationId,
    title: `Reaccept ${suffix}`,
    slug: `reaccept-event-${suffix}`,
    startDateTime: new Date("2035-01-01T10:00:00.000Z"),
    endDateTime: new Date("2035-01-01T12:00:00.000Z"),
    timezone: "UTC",
    status: EventStatus.PUBLISHED,
    privacyType: EventPrivacyType.APPROVAL_REQUIRED,
    capacity: 1,
    page: { create: { isPublished: true } },
  } });
  eventId = event.id;
  for (const guest of [roomGuest, fullGuest]) {
    await prisma.rSVP.create({ data: { eventId, attendeeKey: `guest:${guest.email}`, guestEmail: guest.email, guestName: guest.name, status: RsvpStatus.PENDING_APPROVAL } });
  }
  const owner = await prisma.user.create({
    data: { email: ownerEmail, name: "Reaccept owner", passwordHash: await bcrypt.hash(password, 12), emailVerified: new Date(), memberships: { create: { organisationId, role: MembershipRole.OWNER } } },
  });
  ownerId = owner.id;
});

test.afterAll(async () => {
  await prisma.outboxMessage.deleteMany({ where: { OR: [roomGuest, fullGuest].map((guest) => ({ payload: { path: ["to"], equals: guest.email } })) } });
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});

async function openGuests(page: Page) {
  // A client address unique to this run, so per-IP sign-in and attendee-update
  // limits (kept in Redis between runs) never couple it to another run.
  await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": `198.18.${randomInt(256)}.${randomInt(1, 255)}` });
  await page.request.get("/api/auth/csrf");
  await page.goto("/login?callbackUrl=%2Fdashboard");
  await page.getByRole("textbox", { name: /^Email/ }).fill(ownerEmail);
  await page.locator('input[type="password"]:visible').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/dashboard/${orgSlug}/event/${eventId}?tab=guests`);
  const list = page.getByRole("list", { name: "Guests" });
  return (name: string) => list.getByRole("listitem").filter({ hasText: name });
}

const status = (email: string) => prisma.rSVP.findFirstOrThrow({ where: { eventId, guestEmail: email } }).then((rsvp) => rsvp.status);

test("an organiser declines by mistake and re-accepts: confirmed with room, then waitlisted when full", async ({ page }) => {
  const row = await openGuests(page);
  const statusFilter = page.getByRole("group", { name: "Filter by status" });

  await row(roomGuest.name).getByRole("button", { name: `Decline ${roomGuest.name}` }).click();
  await expect(page.getByRole("status").getByText("Declined", { exact: true })).toBeVisible();
  await expect(row(roomGuest.name).getByText("Declined", { exact: true })).toBeVisible();
  await expect(statusFilter.getByRole("button", { name: /^Declined/ })).toContainText("1");
  await expect.poll(() => status(roomGuest.email)).toBe(RsvpStatus.REJECTED);

  await row(roomGuest.name).getByRole("button", { name: `Re-accept ${roomGuest.name}` }).click();
  await expect(page.getByRole("status").getByText("Re-accepted", { exact: true })).toBeVisible();
  await expect(row(roomGuest.name).getByText("Going", { exact: true })).toBeVisible();
  await expect(row(roomGuest.name).getByRole("button", { name: `Re-accept ${roomGuest.name}` })).toHaveCount(0);
  await expect(statusFilter.getByRole("button", { name: /^Declined/ })).toContainText("0");
  await expect.poll(() => status(roomGuest.email)).toBe(RsvpStatus.CONFIRMED);

  // The only place is now taken, so re-accepting the second guest waitlists them.
  await row(fullGuest.name).getByRole("button", { name: `Decline ${fullGuest.name}` }).click();
  await expect(row(fullGuest.name).getByRole("button", { name: `Re-accept ${fullGuest.name}` })).toBeVisible();
  await row(fullGuest.name).getByRole("button", { name: `Re-accept ${fullGuest.name}` }).click();
  await expect(page.getByRole("status").getByText("Re-accepted. The event is full, so they are on the waitlist.")).toBeVisible();
  await expect(row(fullGuest.name).getByRole("button", { name: `Give ${fullGuest.name} a spot` })).toBeVisible();
  await expect.poll(() => status(fullGuest.email)).toBe(RsvpStatus.WAITLISTED);
  await expect(prisma.auditEvent.count({ where: { action: "RSVP_REACCEPTED", organisationId } })).resolves.toBe(2);
});
