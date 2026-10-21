import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { EventPrivacyType, EventStatus, MembershipRole, PrismaClient, RsvpStatus } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

/*
 * The Emails tab keeps a custom email as a server-side draft: it autosaves,
 * survives a reload, asks before a template overwrites it, and is cleared by
 * the real send (after the 5-second undo window).
 */
test.describe.configure({ mode: "serial" });
const prisma = new PrismaClient();
const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `drafts-${suffix}`;
const password = "broadcast-draft-browser-password";
const ownerEmail = `drafts-owner-${suffix}@example.test`;
const guestEmail = `drafts-guest-${suffix}@example.test`;
const customSubject = `Parking update ${suffix.slice(0, 6)}`;
const customBody = `Use the north entrance, the car park by the hall is closed ${suffix.slice(0, 6)}.`;
let organisationId = "";
let eventId = "";
let ownerId = "";

test.beforeAll(async () => {
  organisationId = (await prisma.organisation.create({ data: { name: `Drafts ${suffix}`, slug: orgSlug } })).id;
  eventId = (await prisma.event.create({
    data: {
      organisationId,
      title: `Draft journey ${suffix}`,
      slug: `draft-journey-${suffix}`,
      startDateTime: new Date("2035-01-01T10:00:00.000Z"),
      endDateTime: new Date("2035-01-01T12:00:00.000Z"),
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      page: { create: { isPublished: true } },
    },
  })).id;
  await prisma.rSVP.create({ data: { eventId, attendeeKey: `guest:${guestEmail}`, guestName: "Draft Guest", guestEmail, status: RsvpStatus.CONFIRMED } });
  ownerId = (await prisma.user.create({
    data: {
      email: ownerEmail,
      name: "Draft Owner",
      passwordHash: await bcrypt.hash(password, 12),
      emailVerified: new Date(),
      memberships: { create: { organisationId, role: MembershipRole.OWNER } },
    },
  })).id;
});

/** The broadcast queues a real message to the seeded guest; drop it before a worker pass can try to deliver it. */
async function discardQueuedEmail() {
  const broadcasts = await prisma.eventBroadcast.findMany({ where: { eventId }, select: { id: true } });
  if (broadcasts.length === 0) return;
  await prisma.outboxMessage.deleteMany({ where: { OR: broadcasts.map((broadcast) => ({ payload: { path: ["broadcastId"], equals: broadcast.id } })) } });
}

test.afterAll(async () => {
  await discardQueuedEmail();
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
  await prisma.$disconnect();
});

async function signIn(page: Page) {
  await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": "192.0.2.231" });
  await page.request.get("/api/auth/csrf");
  await page.goto("/login?callbackUrl=%2Fdashboard");
  await page.getByRole("textbox", { name: /^Email/ }).fill(ownerEmail);
  await page.locator('input[type="password"]:visible').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

const emailsTab = () => `/dashboard/${orgSlug}/event/${eventId}?tab=emails`;
const subjectField = (page: Page) => page.getByRole("textbox", { name: /^Subject/ });
const messageEditor = (page: Page) => page.getByRole("textbox", { name: "Message" });
const draftStatus = (page: Page) => page.getByRole("status").filter({ hasText: /Draft saved|Saving…|Unsaved changes|Couldn't save|saved as a draft automatically/ });

async function openEmails(page: Page) {
  await page.goto(emailsTab());
  await expect(subjectField(page)).toBeVisible({ timeout: 60_000 });
  // The editor mounts on the client; wait until it is editable.
  await expect(messageEditor(page)).toHaveAttribute("contenteditable", "true", { timeout: 60_000 });
}

/** Whether leaving now would show the browser's "Leave site?" prompt. */
const leaveIsGuarded = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

test("a custom email autosaves, survives a reload, and is cleared by sending it", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await openEmails(page);
  await expect(draftStatus(page)).toHaveText("Changes are saved as a draft automatically.");
  expect(await leaveIsGuarded(page)).toBe(false);

  await subjectField(page).fill(customSubject);
  // Unsaved for about 1.5 s until the debounce fires, so leaving asks first.
  await expect.poll(() => leaveIsGuarded(page), { intervals: [50] }).toBe(true);
  await messageEditor(page).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(customBody);

  await expect(draftStatus(page)).toContainText("Draft saved", { timeout: 15_000 });
  await expect.poll(() => leaveIsGuarded(page)).toBe(false);
  await expect.poll(async () => (await prisma.eventBroadcastDraft.findUnique({ where: { eventId_userId: { eventId, userId: ownerId } } }))?.subject).toBe(customSubject);
  const stored = await prisma.eventBroadcastDraft.findUniqueOrThrow({ where: { eventId_userId: { eventId, userId: ownerId } } });
  expect(stored.body).toContain(customBody);

  await page.reload();
  await expect(subjectField(page)).toHaveValue(customSubject, { timeout: 60_000 });
  await expect(messageEditor(page)).toContainText(customBody);
  await expect(draftStatus(page)).toContainText("Draft saved");

  // Picking a template asks first; keeping the draft leaves it untouched.
  await page.getByRole("button", { name: /^Reminder/ }).first().click();
  const replace = page.getByRole("alertdialog", { name: "Replace your draft?" });
  await expect(replace).toBeVisible();
  await replace.getByRole("button", { name: "Keep my draft" }).click();
  await expect(replace).toBeHidden();
  await expect(subjectField(page)).toHaveValue(customSubject);

  // Send it for real: review, confirm, and let the undo window pass.
  const send = page.getByRole("button", { name: "Send to 1 person" });
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
  const review = page.getByRole("dialog", { name: "Send to 1 person?" });
  await expect(review).toContainText(customSubject);
  await review.getByRole("checkbox", { name: /I've checked the preview/ }).check();
  await review.getByRole("button", { name: "Send to 1 person" }).click();
  await expect(page.getByText(/Sending to 1 person in/)).toBeVisible();
  await expect(page.getByText("Queued for 1 recipients")).toBeVisible({ timeout: 20_000 });
  await discardQueuedEmail();

  await expect.poll(() => prisma.eventBroadcastDraft.count({ where: { eventId, userId: ownerId } })).toBe(0);
  await expect(draftStatus(page)).toHaveText("Changes are saved as a draft automatically.");
  expect(await prisma.eventBroadcast.count({ where: { eventId, subject: customSubject } })).toBe(1);

  // After a reload the composer starts fresh; the sent email is only in history.
  await page.reload();
  await expect(subjectField(page)).not.toHaveValue(customSubject, { timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Sent before" })).toContainText(customSubject);
});

test("discarding a draft asks first and removes it from the server", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await openEmails(page);
  await subjectField(page).fill(`Throwaway ${suffix.slice(0, 6)}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(draftStatus(page)).toContainText("Draft saved", { timeout: 15_000 });
  await expect.poll(() => prisma.eventBroadcastDraft.count({ where: { eventId, userId: ownerId } })).toBe(1);

  await page.getByRole("button", { name: "Discard draft" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Discard this draft?" });
  await confirm.getByRole("button", { name: "Discard draft" }).click();
  await expect(confirm).toBeHidden();
  await expect.poll(() => prisma.eventBroadcastDraft.count({ where: { eventId, userId: ownerId } })).toBe(0);
  await expect(subjectField(page)).not.toHaveValue(`Throwaway ${suffix.slice(0, 6)}`);
  await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
});
