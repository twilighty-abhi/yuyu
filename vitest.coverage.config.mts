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
      // A ratchet a few points below the measured coverage (45.9 / 40.5 /
      // 51.8 / 48.7 on 2026-10-26), so a real drop fails the gate. Raise it
      // as coverage grows; never lower it to make a change pass.
      thresholds: { statements: 43, branches: 38, functions: 49, lines: 46 },
    },
  },
});
