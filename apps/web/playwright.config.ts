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
  webServer: [
    {
      command: "pnpm --filter @zero-vault/worker-api exec wrangler d1 migrations apply zero-vault-db --local && pnpm --filter @zero-vault/worker-api exec wrangler dev --local --port 8787",
      port: 8787,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: "../..",
    },
    {
      command: "pnpm exec next dev --port 3001",
      port: 3001,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:8787",
      },
    },
  ],
});
