import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": rootDir, "server-only": `${rootDir}tests/helpers/server-only.ts` } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
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
