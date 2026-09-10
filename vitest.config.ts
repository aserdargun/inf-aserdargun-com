import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tools/**/*.test.ts", "api/test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    maxWorkers: 2,
    testTimeout: 15_000
  }
});
