import { expect, test } from "@playwright/test";

// The in-app guide (/help): public reading, search, and admin-only sections.
test.describe.configure({ timeout: 120_000 });

test("the guide home lists sections and opens an article", async ({ page }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { level: 1, name: "How can we help?" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Run your first event" }).first().click();
  await expect(page).toHaveURL(/\/help\/getting-started\/organiser-quick-start$/);
  await expect(page.getByRole("heading", { level: 1, name: "Run your first event" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Getting started");
});

test("search finds articles and jumps to the matching section", async ({ page }) => {
  await page.goto("/help/getting-started/welcome");
  // Typing before hydration is lost; wait for the combobox to be interactive.
  const search = page.getByRole("combobox", { name: "Search the guide" });
  await expect.poll(() => search.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactFiber"))), { timeout: 60_000 }).toBe(true);
  await search.click();
  await search.fill("door station pin");
  const results = page.getByRole("listbox", { name: "Guide search results" });
  await expect(results.getByRole("option").first()).toContainText("The door station");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/help\/check-in\/door-station/);
});

test("admin-only sections are hidden from signed-out readers", async ({ page, request }) => {
  await page.goto("/help");
  await expect(page.getByRole("navigation", { name: "Guide" }).first()).not.toContainText("Instance administration");
  const restricted = await request.get("/help/instance/settings");
  expect(restricted.status()).toBe(404);
  const index = await request.get("/api/help/search-index");
  expect(index.headers()["cache-control"]).toBe("private, no-store");
  const body = (await index.json()) as { documents: Array<{ slug: string }> };
  expect(body.documents.some((doc) => doc.slug.startsWith("instance/") || doc.slug.startsWith("developers/"))).toBe(false);
});

test("unknown guide paths are a real 404", async ({ request }) => {
  expect((await request.get("/help/events/not-an-article")).status()).toBe(404);
  expect((await request.get("/help/..%2F..%2Fpackage")).status()).toBe(404);
});
