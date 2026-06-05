import { defineConfig } from "@playwright/test";

const webPort = 3010;
const workerPort = 8790;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /worker-sync\.spec\.ts/u,
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${webPort}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" }
    }
  ],
  webServer: [
    {
      command: `pnpm --filter @zero-vault/worker-api exec wrangler d1 migrations apply zero-vault-db --local && pnpm --filter @zero-vault/worker-api exec wrangler dev --local --port ${workerPort}`,
      port: workerPort,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: "../.."
    },
    {
      command: `pnpm exec next dev --port ${webPort}`,
      port: webPort,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://localhost:${workerPort}`
      }
    }
  ]
});
