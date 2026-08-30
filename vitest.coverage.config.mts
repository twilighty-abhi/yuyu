import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": rootDir, "server-only": `${rootDir}tests/helpers/server-only.ts` } },
  test: {
    environment: "node",
    // Coverage is intentionally service-independent. PostgreSQL suites have
    // their own config and must be invoked only with a disposable TEST_DATABASE_URL.
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "app/actions/**/*.ts"],
      exclude: ["**/*.client.ts"],
      // Comprehensive baseline across every server action and library. Raise
      // these ratchets as additional authorization scenarios are added.
      thresholds: { statements: 10, branches: 6, functions: 12, lines: 10 },
    },
  },
});
