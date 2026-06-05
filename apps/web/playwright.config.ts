import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /vault-flow\.spec\.ts/u,
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3001",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm exec next dev --port 3001",
    port: 3001,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
