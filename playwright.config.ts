import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4280" },
  webServer: {
    command: "pnpm dev:codex",
    url: "http://127.0.0.1:4280/view/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  workers: 1,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
