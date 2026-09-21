import { defineConfig } from "playwright/test";

const browsers: ("chromium" | "firefox" | "webkit")[] = process.env.INF_E2E_ALL_BROWSERS === "true"
  ? ["chromium", "firefox", "webkit"]
  : ["chromium"];

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4280" },
  webServer: {
    command: "node scripts/playwright-local-server.mjs",
    url: "http://127.0.0.1:4280/view/",
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
  workers: 1,
  projects: browsers.map((browserName) => ({ name: browserName, use: { browserName } }))
});
