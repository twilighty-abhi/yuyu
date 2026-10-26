import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/*
 * Large-event measurement (docs/PERFORMANCE.md). Runs only
 * tests/perf/*.perf.ts against PERF_DATABASE_URL, a disposable database
 * filled by tests/perf/seed-large-event.mts. Never part of the unit or
 * integration suites.
 */
const rootDir = fileURLToPath(new URL("../..", import.meta.url));
const perfDatabaseUrl = process.env.PERF_DATABASE_URL?.trim();
if (!perfDatabaseUrl) throw new Error("PERF_DATABASE_URL is required: a disposable database seeded by tests/perf/seed-large-event.mts.");
process.env.DATABASE_URL = perfDatabaseUrl;

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
      "server-only": `${rootDir}tests/helpers/server-only.ts`,
    },
  },
  test: {
    root: rootDir,
    environment: "node",
    include: ["tests/perf/**/*.perf.ts"],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
