# Cloudflare Deployment

Last updated: 2026-06-04

This guide covers deploying Zero Vault's Worker API to Cloudflare Workers with D1 (database) and R2 (object storage). For the self-hosted PostgreSQL deployment, see [deployment.md](./deployment.md).

## Prerequisites

- **Cloudflare account** with Workers paid plan (D1 and R2 require at least the Workers Paid plan).
- **Wrangler CLI** v3+. Install globally or use `npx wrangler`.
  ```sh
  npm install -g wrangler
  # or use npx wrangler (no global install needed)
  ```
- **Node.js 18+** and **pnpm** installed.
- **Wrangler authentication**: log in before running any commands.
  ```sh
  npx wrangler login
  ```

## D1 Database Setup

### Create the database

```sh
cd apps/worker-api
npx wrangler d1 create zero-vault-db
```

Wrangler outputs a `database_id`. Add it to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "zero-vault-db"
database_id = "<your-database-id>"
```

### Apply migrations

```sh
cd apps/worker-api
npx wrangler d1 migrations apply zero-vault-db
```

This runs all SQL files in `apps/worker-api/migrations/` against the remote D1 database. The initial migration (`0001_initial.sql`) creates tables for users, sessions, vault items, recovery packets, trusted devices, and related indexes.

To apply migrations against the local development database (used by `wrangler dev`):

```sh
npx wrangler d1 migrations apply zero-vault-db --local
```

### Verify

```sh
npx wrangler d1 execute zero-vault-db --command "SELECT name FROM sqlite_master WHERE type='table'"
```

## R2 Bucket Setup

### Create the bucket

```sh
npx wrangler r2 bucket create zero-vault-exports
```

Add the binding to `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports"
```

R2 is used for vault export storage. The Worker API writes encrypted export bundles to R2 and returns a signed download URL.

### Verify

```sh
npx wrangler r2 bucket list
```

## Wrangler Secrets

These secrets are encrypted at rest by Cloudflare and injected into the Worker runtime at execution time. Never commit them to the repository.

```sh
cd apps/worker-api

# Random 32+ byte hex string for session signing
npx wrangler secret put SESSION_SECRET

# OPAQUE server setup key (stable, must not change after users register)
npx wrangler secret put OPAQUE_SERVER_SETUP

# Random token for maintenance/admin endpoints
npx wrangler secret put MAINTENANCE_TOKEN
```

Generate a suitable `SESSION_SECRET`:

```sh
openssl rand -hex 32
```

If `OPAQUE_SERVER_SETUP` is left unset, the server auto-generates a key on first request. This key must never change after users register. Back it up immediately after first use.

## Environment Variables

Add non-secret variables to the `[vars]` section of `wrangler.toml`:

```toml
[vars]
ENVIRONMENT = "production"
CORS_ORIGIN = "https://your-domain.com"
```

| Variable | Description | Example |
| --- | --- | --- |
| `ENVIRONMENT` | Deployment environment name | `production` |
| `CORS_ORIGIN` | Allowed origin for CORS | `https://vault.example.com` |

For preview deployments, override variables in an `[env.preview.vars]` section:

```toml
[env.preview.vars]
ENVIRONMENT = "preview"
CORS_ORIGIN = "https://preview.your-domain.com"
```

## Full wrangler.toml Reference

Below is a complete `wrangler.toml` example after all setup steps:

```toml
name = "zero-vault-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"
CORS_ORIGIN = "https://your-domain.com"

[[d1_databases]]
binding = "DB"
database_name = "zero-vault-db"
database_id = "<your-database-id>"

[[r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports"

[env.preview]
name = "zero-vault-api-preview"

[env.preview.vars]
ENVIRONMENT = "preview"
CORS_ORIGIN = "https://preview.your-domain.com"

# Preview uses the same D1 database (or create a separate one)
[[env.preview.d1_databases]]
binding = "DB"
database_name = "zero-vault-db"
database_id = "<your-database-id>"

[[env.preview.r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports"
```

## Local Development

### Worker API only

```sh
cd apps/worker-api
npx pnpm dev
```

This runs `wrangler dev`, which starts a local Worker with a local D1 database. Migrations are applied automatically from the `migrations/` directory.

### Full stack (API + Web + Extension)

In separate terminals:

```sh
# Terminal 1: Worker API
cd apps/worker-api && npx pnpm dev

# Terminal 2: Web Vault
npx pnpm dev:web

# Terminal 3: Extension (after Web Vault is running)
npx pnpm dev:extension
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8787` in the Web Vault's `.env.local` to point at the local Worker API (Wrangler dev defaults to port 8787).

### D1 local database

The local D1 database file is stored in `.wrangler/state/v3/d1/` inside the `apps/worker-api` directory. To reset it, delete that directory and restart `wrangler dev`.

## Preview Deployment

Deploy to the preview environment:

```sh
cd apps/worker-api
npx wrangler deploy --env preview
```

This uses the `[env.preview]` configuration from `wrangler.toml`. The Worker is deployed to `zero-vault-api-preview.<your-subdomain>.workers.dev`.

Apply preview migrations if using a separate D1 database:

```sh
npx wrangler d1 migrations apply zero-vault-db-preview --env preview
```

## Production Deployment

```sh
cd apps/worker-api
npx wrangler deploy --env production
```

Or without `--env` (defaults to top-level configuration):

```sh
cd apps/worker-api
npx wrangler deploy
```

The Worker is deployed to `zero-vault-api.<your-subdomain>.workers.dev`.

### Post-deployment checklist

- [ ] Verify D1 migrations have been applied.
- [ ] Verify secrets (`SESSION_SECRET`, `OPAQUE_SERVER_SETUP`, `MAINTENANCE_TOKEN`) are set.
- [ ] Verify `CORS_ORIGIN` matches the Web Vault URL.
- [ ] Test registration and login flows.
- [ ] Test item-level sync push and pull.

## Web Vault Configuration

The Web Vault needs the Worker API URL. Set `NEXT_PUBLIC_API_URL` in the Web Vault's environment:

```
NEXT_PUBLIC_API_URL=https://zero-vault-api.your-subdomain.workers.dev
```

For Next.js, this can be set in:
- `.env.local` for local development.
- Vercel project settings or equivalent for the deployed Web Vault.

## Custom Domain (Optional)

To serve the Worker API from a custom domain:

1. Go to the Cloudflare dashboard.
2. Navigate to Workers and Pages > your Worker > Settings > Domains and Routes.
3. Add a custom domain (e.g., `api.your-domain.com`).
4. Update `CORS_ORIGIN` in `wrangler.toml` to match:
   ```toml
   CORS_ORIGIN = "https://api.your-domain.com"
   ```
5. Redeploy if the domain was added after the last deploy.

Custom domains on Cloudflare Workers automatically get TLS certificates.

## Monitoring

### Workers dashboard

View request logs, error rates, and CPU usage in the Cloudflare dashboard under Workers and Pages > your Worker > Logs. Use `wrangler tail` for real-time log streaming:

```sh
npx wrangler tail
```

### D1 dashboard

Monitor database size, query counts, and row reads/writes in the Cloudflare dashboard under Workers and Pages > D1 > zero-vault-db.

### R2 dashboard

Monitor storage usage and request counts in the Cloudflare dashboard under R2 > zero-vault-exports.

### Alerts

Configure Cloudflare Notifications in the dashboard for:
- Worker error rate spikes.
- D1 storage approaching limits.
- R2 storage approaching limits.

## Troubleshooting

### D1 migration fails

- Ensure the `database_id` in `wrangler.toml` matches the output from `wrangler d1 create`.
- Check that the migration SQL is valid SQLite syntax (D1 uses SQLite).
- Run `npx wrangler d1 execute zero-vault-db --command "PRAGMA table_list"` to inspect current tables.

### Worker returns 500 on startup

- Verify all secrets are set: `npx wrangler secret list`.
- Check Worker logs: `npx wrangler tail`.
- Ensure `OPAQUE_SERVER_SETUP` is valid if set manually.

### CORS errors from Web Vault

- Verify `CORS_ORIGIN` matches the exact origin (protocol + domain + port).
- Do not include a trailing slash.
- Redeploy the Worker after changing environment variables.

### WASM not loading in Worker runtime

- The Worker runtime supports WASM via standard ES module imports.
- If `crypto-core-wasm` fails to load, verify the WASM binary is bundled correctly.
- Test locally with `wrangler dev` before deploying.
