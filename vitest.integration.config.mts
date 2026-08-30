import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for PostgreSQL integration tests; point it only at a disposable database.",
  );
}

// Never inherit an ambient application DATABASE_URL for a destructive test
// suite. All Prisma clients created by the tests use the explicitly named test
// database instead.
process.env.DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
      "server-only": `${rootDir}tests/helpers/server-only.ts`,
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
  },
});
