import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A `loading.tsx` is a Suspense boundary around its segment's page and every
 * segment below it (not its own layout). Once the fallback streams, the HTTP
 * status is a fixed 200, so a notFound()/redirect() inside the boundary becomes
 * a streamed not-found page or a client-side redirect instead of a real
 * 404/307. Every loading screen therefore sits below a layout that already ran
 * the wrapped page's access check (lib/dashboardGuards.ts).
 *
 * This pins every loading.tsx in app/, the guard its layout awaits, and the
 * exact pages it wraps. Adding a loading.tsx, or a page or layout under one,
 * fails here until the new boundary's access checks have been moved above it.
 */

const root = resolve(import.meta.dirname, "../..");
const appDir = resolve(root, "app");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

type Boundary = {
  /** The layout that runs the wrapped pages' check, outside this boundary. */
  guardLayout: string;
  guard: RegExp;
  /** Files rendered inside the boundary, relative to its directory. */
  wraps: string[];
};

const boundaries: Record<string, Boundary> = {
  "app/dashboard/(home)": { guardLayout: "app/dashboard/layout.tsx", guard: /redirect\("\/login"\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/(overview)": { guardLayout: "app/dashboard/[orgSlug]/layout.tsx", guard: /await guardOrgDashboard\(orgSlug\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/members": { guardLayout: "app/dashboard/[orgSlug]/members/layout.tsx", guard: /await guardOrgRole\(orgSlug, "MEMBER"\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/series/[seriesId]": { guardLayout: "app/dashboard/[orgSlug]/series/[seriesId]/layout.tsx", guard: /await guardSeriesDashboard\(orgSlug, seriesId\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/settings/(general)": { guardLayout: "app/dashboard/[orgSlug]/settings/layout.tsx", guard: /await guardOrgRole\(orgSlug, "ADMIN"\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/settings/api": { guardLayout: "app/dashboard/[orgSlug]/settings/api/layout.tsx", guard: /await guardOrgRole\(orgSlug, "OWNER"\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/settings/webhooks/(list)": { guardLayout: "app/dashboard/[orgSlug]/settings/layout.tsx", guard: /await guardOrgRole\(orgSlug, "ADMIN"\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/settings/webhooks/[endpointId]": { guardLayout: "app/dashboard/[orgSlug]/settings/webhooks/[endpointId]/layout.tsx", guard: /await guardWebhookEndpoint\(orgSlug, endpointId\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/event/[eventId]/(overview)": { guardLayout: "app/dashboard/[orgSlug]/event/[eventId]/layout.tsx", guard: /await guardEventDashboard\(orgSlug, eventId\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/event/[eventId]/check-in": { guardLayout: "app/dashboard/[orgSlug]/event/[eventId]/check-in/layout.tsx", guard: /await guardEventPermission\(orgSlug, eventId, EventPermission\.CHECK_IN\)/, wraps: ["page.tsx"] },
  "app/dashboard/[orgSlug]/event/[eventId]/schedule": { guardLayout: "app/dashboard/[orgSlug]/event/[eventId]/schedule/layout.tsx", guard: /await guardEventPermission\(orgSlug, eventId, EventPermission\.PUBLISH_AND_SCHEDULE\)/, wraps: ["page.tsx"] },
};

/** Files a Suspense boundary at `dir` renders: its page and everything in nested segments. */
const renderedFile = /^(page|layout|template|default|not-found|forbidden|unauthorized|error)\.(tsx|ts|jsx|js)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const posix = (path: string) => path.split(sep).join("/");
const appFiles = walk(appDir).map((path) => posix(relative(root, path)));

function wrappedFiles(dir: string): string[] {
  return appFiles
    .filter((path) => path.startsWith(`${dir}/`))
    .map((path) => path.slice(dir.length + 1))
    .filter((path) => {
      const name = path.split("/").at(-1) ?? "";
      if (!renderedFile.test(name)) return false;
      // The boundary's own layout/template/error are outside it; its page is inside.
      return path.includes("/") || name.startsWith("page.");
    })
    .sort();
}

describe("dashboard loading boundaries", () => {
  it("allows a loading.tsx only where it is pinned below its access check", () => {
    const loadingDirs = appFiles.filter((path) => /\/loading\.(tsx|ts|jsx|js)$/.test(path)).map((path) => path.slice(0, path.lastIndexOf("/"))).sort();
    expect(loadingDirs).toEqual(Object.keys(boundaries).sort());
  });

  it("has no root or dashboard-wide loading.tsx", () => {
    expect(appFiles).not.toContain("app/loading.tsx");
    expect(appFiles).not.toContain("app/dashboard/loading.tsx");
    expect(appFiles).not.toContain("app/dashboard/[orgSlug]/loading.tsx");
    expect(appFiles).not.toContain("app/dashboard/[orgSlug]/event/[eventId]/loading.tsx");
  });

  for (const [dir, boundary] of Object.entries(boundaries)) {
    it(`${dir}/loading.tsx wraps only reviewed pages behind ${boundary.guardLayout}`, () => {
      expect(wrappedFiles(dir)).toEqual([...boundary.wraps].sort());
      // The guard layout is this segment's own layout or an ancestor's, both outside the boundary...
      const guardDir = boundary.guardLayout.slice(0, boundary.guardLayout.lastIndexOf("/"));
      expect(dir === guardDir || dir.startsWith(`${guardDir}/`)).toBe(true);
      expect(source(boundary.guardLayout)).toMatch(boundary.guard);
      // ...and no loading.tsx above that layout wraps it (a segment's own loading.tsx does not).
      for (const other of Object.keys(boundaries)) {
        expect(guardDir.startsWith(`${other}/`)).toBe(false);
      }
    });
  }

  it("streams no page-level Suspense boundary outside the reviewed sign-in form", () => {
    const withSuspense = appFiles.filter((path) => /\.(tsx|jsx)$/.test(path) && /<Suspense\b/.test(source(path)));
    expect(withSuspense).toEqual(["app/(auth)/login/page.tsx"]);
  });
});
