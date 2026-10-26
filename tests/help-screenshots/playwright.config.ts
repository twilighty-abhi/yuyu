import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/*
 * Captures the in-app guide's screenshots (public/help/*.png) from a seeded
 * local instance. The seed deletes and recreates its demo data, so point
 * HELP_SCREENS_DATABASE_URL at a disposable, migrated database, never at a
 * database you care about. See content/help/README.md.
 */

const databaseUrl = process.env.HELP_SCREENS_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set HELP_SCREENS_DATABASE_URL to a disposable, migrated PostgreSQL database.");
}
// The capture spec seeds through Prisma, which reads DATABASE_URL.
process.env.DATABASE_URL = databaseUrl;

const port = Number(process.env.HELP_SCREENS_PORT || 3124);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "capture.spec.ts",
  outputDir: "../../test-results/help-screenshots",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 15 * 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    actionTimeout: 60_000,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-GB",
    timezoneId: "Europe/London",
  },
  webServer: {
    command: `npx next dev -p ${port}`,
    cwd: path.resolve(__dirname, "../.."),
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      NEXT_PUBLIC_BASE_URL: baseURL,
      SUPER_ADMIN_EMAIL: "root@example.org",
      // Each browser context sends its own client address (per-IP rate limits).
      TRUSTED_PROXY_IP_HEADER: "cf-connecting-ip",
      // Never deliver mail from a capture run: no SMTP from the environment.
      SMTP_SERVICE: "",
      SMTP_HOST: "",
      // Placeholder Google client, so no real deployment value reaches a screenshot.
      AUTH_GOOGLE_ID: "000000000000-example.apps.googleusercontent.com",
      AUTH_GOOGLE_SECRET: "example-client-secret",
    },
  },
});
