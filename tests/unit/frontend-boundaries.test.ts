import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("frontend production boundaries", () => {
  it("uses explicit bounded public and attendee browser collections", () => {
    const publicPage = source("app/[orgSlug]/page.tsx");
    const eventDashboard = source("app/dashboard/[orgSlug]/event/[eventId]/page.tsx");
    expect(publicPage).toContain("select: publicOrgEventSelect");
    expect(publicPage).toContain("take: PUBLIC_COLLECTION_LIMIT + 1");
    expect(eventDashboard).toContain("take: MAX_BROWSER_ATTENDEES + 1");
    expect(eventDashboard).toContain("user: { select: { id: true, name: true, email: true } }");
  });

  it("keeps calendar controls keyboard-named and production errors category-only", () => {
    const calendar = source("components/org/OrgEventsContainer.tsx");
    expect(calendar).toContain('aria-label="Previous month"');
    expect(calendar).toContain('aria-label="Next month"');
    expect(calendar).toContain("<ButtonBase");
    expect(calendar).toContain("aria-pressed={isSelected}");

    for (const path of ["app/error.tsx", "app/global-error.tsx"]) {
      const boundary = source(path);
      expect(boundary).toContain('process.env.NODE_ENV === "development"');
      expect(boundary).toMatch(/else console\.error\("\[ui\] (?:route|global) error"\)/);
    }
  });

  it("limits service-worker storage to same-origin static build assets", () => {
    const worker = source("public/sw.js");
    expect(worker).toContain('request.method !== "GET"');
    expect(worker).toContain('new URL(request.url).origin !== self.location.origin');
    expect(worker).toContain('request.url.includes("/_next/static/")');
    expect(worker).toContain("MAX_STATIC_ENTRIES");
    expect(worker).not.toContain("/api/");
  });
});
