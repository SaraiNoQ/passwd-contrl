import { defineConfig } from "@playwright/test";

const webPort = 3010;
const workerPort = 8790;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /(?:worker-sync|cross-device-sync)\.spec\.ts/u,
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
      command: `apps/worker-api/node_modules/.bin/wrangler d1 migrations apply zero-vault-db --local --config apps/worker-api/wrangler.toml && apps/worker-api/node_modules/.bin/wrangler dev --local --port ${workerPort} --var ENVIRONMENT:development --config apps/worker-api/wrangler.toml`,
      port: workerPort,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: "../.."
    },
    {
      command: `node_modules/.bin/next dev --port ${webPort}`,
      port: webPort,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://localhost:${workerPort}`
      }
    }
  ]
});
