import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("frontend production boundaries", () => {
  it("uses explicit bounded public and attendee browser collections", () => {
    const publicPage = source("app/[orgSlug]/page.tsx");
    // The event dashboard pages attendees on the server through one shared loader.
    const eventDashboard = source("lib/eventDashboard/attendees.ts");
    expect(publicPage).toContain("select: publicOrgEventSelect");
    expect(publicPage).toContain("take: PUBLIC_COLLECTION_LIMIT + 1");
    expect(eventDashboard).toContain("take: ATTENDEES_PAGE_SIZE + 1");
    expect(eventDashboard).toContain("user: { select: { id: true, name: true, email: true } }");
  });

  it("keeps calendar controls keyboard-named and production errors category-only", () => {
    const calendar = source("components/org/OrgEventsContainer.tsx");
    const iconButton = source("components/ui/button.tsx");
    // IconButton requires a label and renders it as the accessible name.
    expect(calendar).toContain('label="Previous month"');
    expect(calendar).toContain('label="Next month"');
    expect(iconButton).toContain("aria-label={label}");
    expect(calendar).toContain('type="button"');
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

  it("provides accessible navigation, reduced motion, and install metadata", () => {
    const chrome = source("components/chrome/ChromeSwitch.tsx");
    const appShell = source("components/chrome/AppShell.tsx");
    const organiserChrome = source("components/chrome/OrganiserChrome.tsx");
    const notFoundPet = source("components/feedback/NotFoundPet.tsx");
    const styles = source("app/globals.css");
    const manifest = source("app/manifest.ts");
    expect(chrome).toContain('href="#main-content"');
    expect(chrome).toContain('id="main-content"');
    expect(appShell).toContain('id="main-content"');
    expect(organiserChrome).toContain('id="main-content"');
    expect(notFoundPet).toContain("prefers-reduced-motion: reduce");
    expect(styles).toContain("prefers-reduced-motion: reduce");
    expect(manifest).toContain('display: "standalone"');
    expect(manifest).toContain('start_url: "/dashboard"');
  });

  it("requires confirmations for destructive editor actions", () => {
    expect(source("components/series/EditSeriesForm.tsx")).toContain('title="Delete event series?"');
    expect(source("components/feedback/FeedbackFormEditor.tsx")).toContain('title="Delete feedback question?"');
    expect(source("components/event/EventWebsiteManager.tsx")).toContain('title="Remove event-page content?"');
  });
});
