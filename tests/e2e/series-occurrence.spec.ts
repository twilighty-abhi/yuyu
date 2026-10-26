import { randomUUID } from "node:crypto";
import { EventPrivacyType, EventStatus, PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";

const prisma = new PrismaClient();
const suffix = randomUUID().replace(/-/g, "");
let organisationId: string;
let orgSlug: string;
let instanceId: string;

test.beforeAll(async () => {
  orgSlug = `e2e-series-${suffix}`;
  const organisation = await prisma.organisation.create({ data: { name: `E2E Series ${suffix}`, slug: orgSlug } });
  organisationId = organisation.id;
  const start = new Date("2030-02-01T18:00:00.000Z");
  const series = await prisma.eventSeries.create({
    data: {
      organisationId,
      title: `Weekly meetup ${suffix}`,
      slug: `weekly-${suffix}`,
      recurrenceRule: "DTSTART:20300201T180000Z\nRRULE:FREQ=WEEKLY;COUNT=2",
      instanceDurationMs: 3_600_000,
      timezone: "UTC",
      status: EventStatus.PUBLISHED,
      privacyType: EventPrivacyType.PUBLIC,
      instances: {
        create: [
          { startDateTime: start, endDateTime: new Date(start.getTime() + 3_600_000) },
        ],
      },
    },
    include: { instances: true },
  });
  instanceId = series.instances[0]!.id;
});

test.afterAll(async () => {
  await prisma.organisation.deleteMany({ where: { id: organisationId } });
  await prisma.$disconnect();
});

test("registering on a series occurrence updates its going count without a reload", async ({ page }) => {
  await page.goto(`/${orgSlug}/i/${instanceId}`);
  await expect(page.getByText("0 going")).toBeVisible();

  await page.getByLabel("Name").fill("Series Guest");
  await page.getByLabel("Email").fill(`series-${suffix}@example.test`);
  await page.getByRole("button", { name: /register/i }).click();

  await expect(page.getByRole("status").filter({ hasText: /Registration (confirmed|received)/ })).toBeVisible();
  await expect(page.getByText("1 going")).toBeVisible();
});
