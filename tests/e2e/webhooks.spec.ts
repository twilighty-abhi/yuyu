import http from "node:http";
import crypto, { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { MembershipRole, PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";

/**
 * Organisation webhooks in the browser. The server must run with
 * WEBHOOKS_ALLOW_PRIVATE_TARGETS=1 (and, for a production build, the CI test
 * mode) so it may post to the local receiver this spec starts.
 */
test.describe.configure({ mode: "serial" });
test.skip(process.env.WEBHOOKS_ALLOW_PRIVATE_TARGETS !== "1", "Needs WEBHOOKS_ALLOW_PRIVATE_TARGETS=1 for the local webhook receiver.");

const prisma = new PrismaClient();
const suffix = randomUUID().replaceAll("-", "");
const orgSlug = `webhooks-${suffix.slice(0, 20)}`;
const password = "webhooks-browser-password";
const adminEmail = `webhooks-admin-${suffix}@example.test`;
const memberEmail = `webhooks-member-${suffix}@example.test`;
// A fresh client address per run keeps per-IP limits independent of other runs.
const ipBase = `10.${crypto.randomInt(1, 254)}.${crypto.randomInt(1, 254)}`;
let organisationId = "";
const userIds: string[] = [];

type Received = { headers: http.IncomingHttpHeaders; body: string };
const received: Received[] = [];
let receiver: http.Server;
let receiverUrl = "";

test.beforeAll(async () => {
  receiver = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/yuyu-hooks`;

  const organisation = await prisma.organisation.create({ data: { name: `Webhooks ${suffix.slice(0, 8)}`, slug: orgSlug } });
  organisationId = organisation.id;
  const passwordHash = await bcrypt.hash(password, 12);
  for (const [email, role] of [[adminEmail, MembershipRole.ADMIN], [memberEmail, MembershipRole.MEMBER]] as const) {
    const user = await prisma.user.create({
      data: { email, name: `Webhooks ${role.toLowerCase()}`, passwordHash, emailVerified: new Date(), memberships: { create: { organisationId, role } } },
    });
    userIds.push(user.id);
  }
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => receiver.close(() => resolve()));
  if (organisationId) await prisma.organisation.delete({ where: { id: organisationId } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

async function signIn(page: Page, email: string, ip: string) {
  await page.context().setExtraHTTPHeaders({ "cf-connecting-ip": ip });
  await page.request.get("/api/auth/csrf");
  await page.goto("/login?callbackUrl=%2Fdashboard");
  await page.getByRole("textbox", { name: /^Email/ }).fill(email);
  await page.locator('input[type="password"]:visible').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("an admin adds an endpoint, sees the secret once and sends a test", async ({ page }) => {
  await signIn(page, adminEmail, `${ipBase}.11`);
  await page.goto(`/dashboard/${orgSlug}/settings`);
  const section = page.getByRole("region", { name: "Webhooks" });
  await expect(section).toContainText("No endpoints yet");
  await section.getByRole("link", { name: "Manage webhooks" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/${orgSlug}/settings/webhooks$`));

  await page.getByRole("button", { name: "Add endpoint" }).click();
  const form = page.getByRole("dialog", { name: "Add webhook endpoint" });
  await form.getByRole("textbox", { name: /Endpoint URL/ }).fill(receiverUrl);
  await form.getByRole("textbox", { name: /Description/ }).fill("E2E receiver");
  await form.getByRole("checkbox", { name: /Checked in/ }).click();
  await form.getByRole("button", { name: "Add endpoint" }).click();

  const reveal = page.getByRole("dialog", { name: "Copy your signing secret" });
  await expect(reveal).toBeVisible();
  const secret = (await reveal.getByTestId("webhook-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
  await reveal.getByRole("button", { name: "I have stored it" }).click();
  await expect(reveal).toBeHidden();

  // Shown once: never in the list or after a reload.
  await page.reload();
  await expect(page.locator("body")).not.toContainText(secret);
  const row = page.getByRole("link", { name: /Manage endpoint 127\.0\.0\.1/ });
  await expect(row).toContainText("Enabled");
  await row.click();

  await expect(page.getByRole("heading", { name: receiverUrl })).toBeVisible();
  await page.getByRole("button", { name: "Send test" }).click();
  await expect(page.getByText(/Test event: HTTP 200/)).toBeVisible();
  const delivery = page.getByTestId("webhook-delivery-row").first();
  await expect(delivery).toContainText("ping");
  await expect(delivery).toContainText("200");
  await expect(delivery).toContainText("Delivered");
  await expect(page.locator("body")).not.toContainText(secret);

  expect(received).toHaveLength(1);
  const [request] = received;
  expect(request!.headers["x-yuyu-event-type"]).toBe("ping");
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(request!.headers["x-yuyu-signature"]));
  expect(match).not.toBeNull();
  const expected = crypto.createHmac("sha256", secret).update(`${match![1]}.${request!.body}`).digest("hex");
  expect(match![2]).toBe(expected);
});

test("a member does not see webhook settings", async ({ page }) => {
  await signIn(page, memberEmail, `${ipBase}.12`);
  await page.goto(`/dashboard/${orgSlug}/settings`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/${orgSlug}$`));
  await expect(page.getByRole("region", { name: "Webhooks" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Manage webhooks" })).toHaveCount(0);
  await page.goto(`/dashboard/${orgSlug}/settings/webhooks`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/${orgSlug}$`));
  await expect(page.getByRole("button", { name: "Add endpoint" })).toHaveCount(0);
});
