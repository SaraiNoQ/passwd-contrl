import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: { trace: "off", screenshot: "off", baseURL: "http://localhost:3010" },
  projects: [{ name: "chrome" }, ...(process.env.ZERO_VAULT_EDGE_BINARY ? [{ name: "edge" }] : []), ...(process.env.ZERO_VAULT_GECKODRIVER ? [{ name: "firefox" }] : [])],
  webServer: [
    { command: "apps/worker-api/node_modules/.bin/wrangler d1 migrations apply zero-vault-db --local --config apps/worker-api/wrangler.toml && apps/worker-api/node_modules/.bin/wrangler dev --local --port 8790 --var ENVIRONMENT:development --config apps/worker-api/wrangler.toml", port: 8790, cwd: "../..", timeout: 120000 },
    { command: "node_modules/.bin/next dev --port 3010", port: 3010, cwd: "../web", env: { NEXT_PUBLIC_API_URL: "http://localhost:8790" }, timeout: 120000 }
  ]
});
