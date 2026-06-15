import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /\.spec\.ts$/u,
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3001",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
});
