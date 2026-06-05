# Cloudflare Workers Migration Plan

Last updated: 2026-06-04

This document outlines the strategy for migrating Zero Vault's backend from the current dual-API architecture (Fastify + PostgreSQL / Hono + D1) to a single Cloudflare Worker API using D1 and R2.

---

## 1. Architecture Overview

### Current Dual-API Setup

Zero Vault currently maintains two parallel API implementations:

| Component | `apps/api` (Fastify) | `apps/worker-api` (Hono) |
|---|---|---|
| Framework | Fastify 5 | Hono 4 |
| Database | PostgreSQL via Prisma | D1 (Cloudflare SQLite) |
| Object storage | None (local filesystem) | R2 (Cloudflare) |
| Auth | `@serenity-kit/opaque` (native) | `@serenity-kit/opaque` (WASM) |
| Hosting | Self-hosted / Docker | Cloudflare Workers |
| Store class | `PrismaVaultStore` | `D1VaultStore` |
| Session storage | PostgreSQL table | D1 table |

Both APIs share the `VaultStore` interface defined in `packages/shared`, the same request/response schemas (Zod), and expose an identical route surface:

- `POST /auth/register/start`, `POST /auth/register/finish`
- `POST /auth/login/start`, `POST /auth/login/finish`
- `GET /auth/me`, `GET /auth/session`
- `POST /auth/logout`
- `GET /vault/sync`, `POST /vault/sync`
- `GET /vault/item-sync`, `POST /vault/item-sync`
- `GET /vault/items/:id/history`
- `GET /vault/recovery-packet`, `POST /vault/recovery-packet`
- `GET /devices`, `POST /devices`
- `POST /devices/:id/approve`, `POST /devices/:id/reject`, `POST /devices/:id/revoke`
- `POST /maintenance/cleanup-expired-sessions`
- `POST /exports/create`, `GET /exports`, `GET /exports/:id`, `DELETE /exports/:id`

The Worker API already has full route parity and a complete D1 store implementation. The Fastify API is the currently-deployed production backend.

### Target Architecture

Single Worker API (`apps/worker-api`) serving all traffic:

```
Client (Web Vault / Extension)
    |
    v
Cloudflare Workers (Hono)
    |
    +---> D1 (users, sessions, vault_items, etc.)
    +---> R2 (encrypted vault exports)
    +---> Wrangler Secrets (OPAQUE_SERVER_SETUP, SESSION_SECRET, MAINTENANCE_TOKEN)
```

### D1 vs PostgreSQL Trade-offs

| Consideration | D1 (SQLite) | PostgreSQL |
|---|---|---|
| **Global edge** | Data replicated to Cloudflare edge; sub-10ms reads in most regions | Single-region; latency depends on client proximity |
| **Cost model** | Pay per read/write row; free tier includes 5B reads/mo | Pay for compute + storage + connections |
| **Storage limit** | 10 GB per database (as of 2026) | Unlimited (managed instance) |
| **Query complexity** | SQLite subset; no CTEs before D1 v2, limited joins | Full SQL including CTEs, window functions, lateral joins |
| **Transactions** | Batch API (`db.batch()`); single-statement auto-commit | Full ACID transactions |
| **Connection pooling** | Not needed (serverless, no persistent connections) | Required (PgBouncer or Prisma pool) |
| **Backup/export** | `wrangler d1 export` to SQL dump | `pg_dump`, logical replication |
| **JSON support** | `json_extract()` on TEXT columns | Native JSON/JSONB with indexing |
| **Concurrent writes** | Serialized per database; fine for single-user vault writes | Full concurrent write support |
| **Operational overhead** | Zero (managed by Cloudflare) | High (provisioning, monitoring, scaling, patching) |

**Verdict for Zero Vault**: D1 is well-suited. The workload is read-heavy (vault sync pulls), writes are single-user scoped (no cross-user contention), and the data model is straightforward. The 10 GB limit is not a concern for an encrypted password vault (each user's data is a few KB to low MB). The serverless model eliminates connection pooling complexity and reduces operational cost.

---

## 2. Migration Strategy

### Phase 1: Worker API as Primary (D1)

**Goal**: Route all production traffic to the Worker API backed by D1.

**Steps**:

1. **Provision D1 production database** (see Section 3).
2. **Apply all migrations** to the production D1 database:
   ```sh
   cd apps/worker-api
   npx wrangler d1 migrations apply zero-vault-db
   ```
3. **Set all Worker secrets** (`SESSION_SECRET`, `OPAQUE_SERVER_SETUP`, `MAINTENANCE_TOKEN`).
4. **Update Web Vault** `NEXT_PUBLIC_API_URL` to point at the Worker API domain.
5. **Update Extension** API endpoint configuration to the Worker API domain.
6. **Run smoke tests**: registration, login, vault sync, item-level sync, device trust, recovery packet, exports.

**Cutover risk**: This is a clean break. All new users register on D1. Existing PostgreSQL users cannot log in unless their data is migrated first (Phase 2).

**Recommended approach for zero-downtime**: Complete Phase 2 (data migration) before switching traffic, or run a brief maintenance window.

### Phase 2: Data Migration from PostgreSQL to D1

**Goal**: Migrate all existing user data from PostgreSQL to D1.

See Section 4 for the detailed migration procedure.

**Steps**:

1. **Export PostgreSQL data** to a structured format (JSON or SQL dump).
2. **Transform** PostgreSQL schema to D1 schema (see schema mapping below).
3. **Import** into D1 via `wrangler d1 execute`.
4. **Validate** row counts, referential integrity, and sample data.
5. **Run integration tests** against the migrated D1 database.

**Dual-write consideration**: If zero-downtime is required, consider running both APIs in parallel during the transition:
- Worker API reads from D1.
- Fastify API writes to both PostgreSQL and D1 (dual-write).
- Once D1 catches up, cut over reads to Worker API, then stop dual-write.

This is complex and likely unnecessary for an early-stage project. A scheduled maintenance window (e.g., 30 minutes) with a clean migration is simpler and safer.

### Phase 3: Deprecate Fastify API -- COMPLETE

**Goal**: Remove `apps/api` from the codebase.

**Completed steps**:

1. Verified all clients (Web Vault, Extension) point at the Worker API.
2. Removed `apps/api/` directory (Fastify server, Prisma schema, memory store, tests).
3. Removed `dev:api` script from root `package.json`.
4. Removed Docker Compose PostgreSQL service from `docker-compose.yml`.
5. Updated all documentation to remove PostgreSQL/Fastify references.

---

## 3. Infrastructure Requirements

### D1 Database Setup

```sh
# Create production database
cd apps/worker-api
npx wrangler d1 create zero-vault-db

# Create staging database (separate)
npx wrangler d1 create zero-vault-db-staging
```

Each command outputs a `database_id`. Store these in `wrangler.toml`:

```toml
# Production (default)
[[d1_databases]]
binding = "DB"
database_name = "zero-vault-db"
database_id = "<production-id>"

# Staging
[env.staging]
name = "zero-vault-api-staging"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "zero-vault-db-staging"
database_id = "<staging-id>"
```

### R2 Bucket for Exports

```sh
# Production bucket
npx wrangler r2 bucket create zero-vault-exports

# Staging bucket
npx wrangler r2 bucket create zero-vault-exports-staging
```

Add to `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports"

[[env.staging.r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports-staging"
```

### Worker Secrets Configuration

```sh
cd apps/worker-api

# Production secrets
npx wrangler secret put SESSION_SECRET        # openssl rand -hex 32
npx wrangler secret put OPAQUE_SERVER_SETUP   # existing value from Fastify API
npx wrangler secret put MAINTENANCE_TOKEN     # openssl rand -hex 32

# Staging secrets (scoped to staging env)
npx wrangler secret put SESSION_SECRET --env staging
npx wrangler secret put OPAQUE_SERVER_SETUP --env staging
npx wrangler secret put MAINTENANCE_TOKEN --env staging
```

**Critical**: `OPAQUE_SERVER_SETUP` must be the same value used during user registration. If migrating from the Fastify API, export the existing value from the Fastify API's environment/secrets manager and set it on the Worker. Changing this value will break all existing user logins.

### Custom Domain Setup

1. Add domain to Cloudflare (if not already managed there).
2. In the Cloudflare dashboard: Workers & Pages > zero-vault-api > Settings > Domains and Routes.
3. Add custom domain: `api.your-domain.com`.
4. Update `CORS_ORIGIN` in `wrangler.toml`:
   ```toml
   [vars]
   CORS_ORIGIN = "https://api.your-domain.com"
   ```
5. Redeploy the Worker.

Custom domains on Cloudflare Workers automatically provision TLS certificates.

### KV for Session Storage (Optional)

KV is not currently used but could replace D1 session lookups for lower latency:

**When to consider KV for sessions**:
- D1 session reads become a bottleneck (unlikely at current scale).
- You need sub-5ms session lookups globally.

**If implemented**:

```toml
[[kv_namespaces]]
binding = "SESSIONS"
id = "<kv-namespace-id>"
```

Session tokens would be stored as KV keys with TTL matching the session expiry. The `sessionMiddleware` would check KV first, falling back to D1. This is a future optimization and not required for the initial migration.

---

## 4. Data Migration

### PostgreSQL to D1 Migration Script

The migration script should be a standalone Node.js script that reads from PostgreSQL and writes to D1 via the Wrangler D1 HTTP API or direct SQL execution.

**Location**: `scripts/migrate-pg-to-d1.ts`

**Approach**:

```typescript
// Pseudocode for the migration script
import { PrismaClient } from "@prisma/client";

// 1. Read all data from PostgreSQL via Prisma
const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  include: {
    vaultRevision: true,
    sessions: true,
    registrationSessions: true,
    loginSessions: true,
    vaultItems: { include: { history: true } },
    recoveryPacket: true,
    trustedDevices: true,
    deviceVaultKeys: true,
  },
});

// 2. Generate D1-compatible SQL statements
const statements: string[] = [];
for (const user of users) {
  statements.push(buildInsertUser(user));
  // ... sessions, vault items, etc.
}

// 3. Write to D1 via wrangler d1 execute
// Or output to a .sql file for manual import
```

### Schema Mapping

| PostgreSQL (Prisma) | D1 (SQLite) | Notes |
|---|---|---|
| `User.id` (UUID) | `users.id` (TEXT) | Same value |
| `User.email` (String) | `users.email` (TEXT) | Same value |
| `User.opaqueRegistrationRecord` (String) | `users.opaque_registration_record` (TEXT) | Snake case column name |
| `User.publicKeyBundle` (String) | `users.public_key_bundle` (TEXT) | Snake case |
| `User.encryptedRecoveryPacket` (Json) | `users.encrypted_recovery_packet` (TEXT) | `JSON.stringify()` the JSON value |
| `VaultRevision.current` (Int) | `users.server_revision` (INTEGER) | D1 denormalizes this onto the users table |
| `User.createdAt` (DateTime) | `users.created_at` (TEXT) | Convert to ISO 8601 string |
| `User.updatedAt` (DateTime) | `users.updated_at` (TEXT) | Convert to ISO 8601 string |
| `Session.tokenHash` (String) | `sessions.token_hash` (TEXT) | Snake case |
| `Session.csrfToken` (String) | `sessions.csrf_token` (TEXT) | Snake case |
| `Session.expiresAt` (DateTime) | `sessions.expires_at` (TEXT) | ISO 8601 string |
| `OpaqueRegistrationSession` | `registration_sessions` | Table renamed |
| `OpaqueRegistrationSession.registrationResponse` | `registration_sessions.registration_response` | Snake case |
| `OpaqueLoginSession` | `login_sessions` | Table renamed |
| `OpaqueLoginSession.serverLoginState` | `login_sessions.server_login_state` | Snake case |
| `VaultItem.encryptedItemKey` (Json) | `vault_items.encrypted_item_key` (TEXT) | `JSON.stringify()` |
| `VaultItem.encryptedPayload` (Json) | `vault_items.encrypted_payload` (TEXT) | `JSON.stringify()` |
| `VaultItem.encryptedSearchTokens` (Json) | `vault_items.encrypted_search_tokens` (TEXT) | `JSON.stringify()`, default `'[]'` |
| `VaultItem.deletedAt` (DateTime?) | `vault_items.deleted_at` (TEXT?) | ISO 8601 string or NULL |
| `VaultItemHistory.snapshot` (Json) | `vault_item_history.snapshot` (TEXT) | `JSON.stringify()` |
| `RecoveryPacket` (separate table) | `recovery_packets` | Same structure |
| `TrustedDevice.publicKey` | `trusted_devices.public_key` | Snake case |
| `DeviceVaultKey.encryptedBlob` | `device_vault_keys.encrypted_blob` | Snake case |
| N/A (PostgreSQL-only) | `device_vault_keys` table | Added in migration 0002 |

**Key differences**:
- D1 stores all dates as ISO 8601 TEXT, not native DateTime.
- D1 stores JSON as TEXT (must be serialized/deserialized manually).
- `VaultRevision` is a separate table in PostgreSQL but merged into `users.server_revision` in D1.
- Column names are snake_case in D1 (SQLite convention) vs camelCase in Prisma.

### Data Validation

After migration, run these checks:

```sh
# Row count comparison (run against both databases)
# PostgreSQL:
psql $DATABASE_URL -c "SELECT 'users', COUNT(*) FROM users UNION ALL SELECT 'sessions', COUNT(*) FROM sessions UNION ALL SELECT 'vault_items', COUNT(*) FROM vault_items"

# D1:
npx wrangler d1 execute zero-vault-db --command "SELECT 'users', COUNT(*) FROM users UNION ALL SELECT 'sessions', COUNT(*) FROM sessions UNION ALL SELECT 'vault_items', COUNT(*) FROM vault_items"
```

**Validation checklist**:
- [ ] User count matches.
- [ ] Session count matches (or is lower in D1 if expired sessions were pruned).
- [ ] Vault item count matches.
- [ ] Vault item history count matches.
- [ ] Recovery packet count matches.
- [ ] Trusted device count matches.
- [ ] Device vault key count matches.
- [ ] Sample 10 random users: verify all fields are correctly migrated.
- [ ] Verify `server_revision` on D1 `users` table matches PostgreSQL `VaultRevision.current`.
- [ ] Test login for 3-5 migrated users (requires `OPAQUE_SERVER_SETUP` to be the same).

---

## 5. Deployment Pipeline

### Wrangler CLI Setup

Already configured in `apps/worker-api/package.json`:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  }
}
```

For the migration pipeline, add a staging deploy command:

```json
{
  "scripts": {
    "deploy:staging": "wrangler deploy --env staging",
    "deploy:production": "wrangler deploy",
    "migrate:staging": "wrangler d1 migrations apply zero-vault-db-staging --env staging",
    "migrate:production": "wrangler d1 migrations apply zero-vault-db"
  }
}
```

### CI/CD with GitHub Actions

Add a new workflow file: `.github/workflows/deploy-worker.yml`

```yaml
name: Deploy Worker API

on:
  push:
    branches: [main]
    paths:
      - "apps/worker-api/**"
      - "packages/shared/**"
  workflow_dispatch:
    inputs:
      environment:
        description: "Deploy target"
        required: true
        default: "staging"
        type: choice
        options:
          - staging
          - production

jobs:
  test:
    name: Test Worker API
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: npx pnpm install --frozen-lockfile
      - run: npx pnpm --filter @zero-vault/worker-api test

  deploy-staging:
    name: Deploy to Staging
    needs: test
    if: github.event_name == 'push' || github.event.inputs.environment == 'staging'
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: npx pnpm install --frozen-lockfile
      - name: Apply D1 migrations
        working-directory: apps/worker-api
        run: npx wrangler d1 migrations apply zero-vault-db-staging --env staging
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Deploy Worker
        working-directory: apps/worker-api
        run: npx wrangler deploy --env staging
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy-production:
    name: Deploy to Production
    needs: test
    if: github.event.inputs.environment == 'production'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: npx pnpm install --frozen-lockfile
      - name: Apply D1 migrations
        working-directory: apps/worker-api
        run: npx wrangler d1 migrations apply zero-vault-db
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Deploy Worker
        working-directory: apps/worker-api
        run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Verify deployment
        run: |
          sleep 5
          curl -sf https://api.your-domain.com/health || exit 1
```

**Required GitHub Secrets**:
- `CLOUDFLARE_API_TOKEN`: Create at Cloudflare Dashboard > My Profile > API Tokens. Use the "Edit Cloudflare Workers" template.
- `CLOUDFLARE_ACCOUNT_ID`: Found in the Cloudflare dashboard sidebar.

### Environment Management

**Three environments**:

| Environment | D1 Database | R2 Bucket | Worker Name | Domain |
|---|---|---|---|---|
| Local dev | `.wrangler/state/v3/d1/` | Local R2 emulator | N/A | `localhost:8787` |
| Staging | `zero-vault-db-staging` | `zero-vault-exports-staging` | `zero-vault-api-staging` | `staging-api.your-domain.com` |
| Production | `zero-vault-db` | `zero-vault-exports` | `zero-vault-api` | `api.your-domain.com` |

**Full `wrangler.toml` with environments**:

```toml
name = "zero-vault-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"
CORS_ORIGIN = "https://vault.your-domain.com"

[[d1_databases]]
binding = "DB"
database_name = "zero-vault-db"
database_id = "<production-d1-id>"

[[r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports"

# ── Staging ────────────────────────────────────────────────────────────────────

[env.staging]
name = "zero-vault-api-staging"

[env.staging.vars]
ENVIRONMENT = "staging"
CORS_ORIGIN = "https://staging-vault.your-domain.com"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "zero-vault-db-staging"
database_id = "<staging-d1-id>"

[[env.staging.r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports-staging"

# ── Preview (PR deployments) ──────────────────────────────────────────────────

[env.preview]
name = "zero-vault-api-preview"

[env.preview.vars]
ENVIRONMENT = "preview"
CORS_ORIGIN = "https://preview-vault.your-domain.com"
```

---

## 6. Cost Analysis

### Cloudflare Workers Pricing (Paid Plan: $5/month)

| Metric | Free Tier | Paid ($5/mo base) | Notes |
|---|---|---|---|
| Requests | 100,000/day | 10 million/month included, $0.30/million after | Each API call = 1 request |
| CPU time | 10ms/invocation | 30ms included (standard), up to 30s (bundled/unbound) | OPAQUE crypto may need higher limits |
| Duration | N/A | 400,000 GB-seconds/month included | Not billed on standard Workers |

### D1 Pricing

| Metric | Free Tier | Paid ($5/mo base) | Notes |
|---|---|---|---|
| Reads | 5 billion rows/month | 25 billion rows/month included, $0.001/million after | Each `SELECT` row read counts |
| Writes | 25 million rows/month | 50 million rows/month included, $0.001/million after | Each `INSERT`/`UPDATE`/`DELETE` row |
| Storage | 5 GB | 5 GB included, $0.75/GB-month after | Encrypted vault data is compact |

### R2 Pricing

| Metric | Free Tier | Paid | Notes |
|---|---|---|---|
| Storage | 10 GB/month | 10 GB included, $0.015/GB-month after | Encrypted export bundles |
| Class A ops (writes) | 1 million/month | 1 million included, $4.50/million after | Export creation |
| Class B ops (reads) | 10 million/month | 10 million included, $0.36/million after | Export downloads |
| Egress | Free | Free | R2 has zero egress fees |

### Expected Costs for Typical Usage

**Scenario**: 1,000 active users, average 50 vault items each, 3 sync operations/day.

| Resource | Monthly Usage | Estimated Cost |
|---|---|---|
| Workers requests | ~90,000 requests/day = ~2.7M/month | Included in $5 base |
| D1 reads | ~100M rows/month (sync pulls + auth) | Included in $5 base |
| D1 writes | ~5M rows/month (sync pushes + sessions) | Included in $5 base |
| D1 storage | ~500 MB (1,000 users x 50 items x ~10KB) | Included in $5 base |
| R2 storage | ~100 MB (occasional exports) | Included in $5 base |
| R2 operations | Minimal | Included in $5 base |
| **Total** | | **$5/month** |

**Scenario**: 100,000 active users, average 100 vault items, 5 sync operations/day.

| Resource | Monthly Usage | Estimated Cost |
|---|---|---|
| Workers requests | ~15M requests/month | ~$1.50 overage |
| D1 reads | ~5B rows/month | Included |
| D1 writes | ~500M rows/month | ~$0.45 overage |
| D1 storage | ~50 GB | ~$33.75 overage |
| R2 storage | ~10 GB | Included |
| **Total** | | **~$40.70/month** |

For comparison, a managed PostgreSQL instance (e.g., Supabase, Neon, or Railway) for 100K users would cost $25-75/month minimum, plus the compute cost of the API server itself ($5-20/month for a small VM or serverless function).

---

## 7. Risk Mitigation

### Rollback Strategy

**Scenario**: Worker API has a critical bug after cutover.

**Rollback plan**:

1. **DNS/routing rollback**: If using a custom domain, point `api.your-domain.com` back to the Fastify API server IP via DNS. Cloudflare DNS changes propagate in seconds (TTL 300s).
2. **Client config rollback**: Update `NEXT_PUBLIC_API_URL` in the Web Vault environment to the Fastify API URL. Redeploy Web Vault.
3. **Extension rollback**: If the extension hardcodes the API URL, publish a hotfix extension update pointing back to the Fastify API.
4. **Data reconciliation**: If any writes occurred on D1 during the Worker API period, export them and apply to PostgreSQL before switching back. This is the hardest part -- see dual-write discussion in Phase 2.

**Prevention**: Run the Worker API in staging for at least 1 week before production cutover. Run automated tests against the staging deployment daily.

### Data Backup Procedures

**D1 backups**:

```sh
# Export full database to SQL file
cd apps/worker-api
npx wrangler d1 export zero-vault-db --remote --output backups/d1-backup-$(date +%Y%m%d).sql

# Schedule daily backups via cron Worker or external cron service
```

**Automated backup approach**: Create a Cloudflare Worker triggered by Cron Triggers that exports D1 to R2:

```typescript
// Backup worker (deployed separately or as a scheduled handler)
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    // Use D1's database export API
    // Store the SQL dump in R2 with a date-stamped key
  }
};
```

**R2 backups**: R2 data is already replicated across Cloudflare regions. For additional safety, enable R2 bucket replication to a secondary bucket.

**PostgreSQL backup (pre-migration)**: Before decommissioning the Fastify API, take a final `pg_dump` and store it securely:

```sh
pg_dump $DATABASE_URL > backups/postgresql-final-$(date +%Y%m%d).sql
```

### Monitoring and Alerting

**Worker monitoring**:
- `wrangler tail` for real-time log streaming during deployments.
- Cloudflare dashboard: Workers & Pages > Logs > zero-vault-api. Monitor error rate, CPU time, and request count.
- Set up Cloudflare Notifications for:
  - Worker error rate > 1% over 5 minutes.
  - Worker CPU time exceeding 80% of limit.

**D1 monitoring**:
- Cloudflare dashboard: D1 > zero-vault-db. Monitor storage size, read/write counts.
- Alert when D1 storage exceeds 80% of 10 GB limit.
- Alert on unusual write spikes (potential abuse or migration issue).

**R2 monitoring**:
- Cloudflare dashboard: R2 > zero-vault-exports. Monitor storage and operation counts.

**Application-level monitoring**:
- Health endpoint: `GET /health` returns `{ ok: true }`.
- Readiness endpoint: `GET /ready` performs a D1 connectivity check.
- Set up an external uptime monitor (e.g., UptimeRobot, Checkly) hitting `/health` every 60 seconds.
- Monitor the `/ready` endpoint to catch D1 connectivity issues.

**Alerting channels**:
- Cloudflare Notifications can send email, PagerDuty, or webhook alerts.
- For webhook alerts, route to a Slack/Discord channel via a simple Cloudflare Worker or external service.

### Additional Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OPAQUE WASM fails in Worker runtime | Low (already tested locally with `wrangler dev`) | High (auth completely broken) | Test OPAQUE registration + login in staging before production. Keep Fastify API available as fallback. |
| D1 performance degradation | Low | Medium (slow sync) | Monitor D1 query latency. D1 read replicas reduce latency for read-heavy workloads. |
| `OPAQUE_SERVER_SETUP` mismatch | Low (human error) | High (all logins fail) | Store the value in a secrets manager. Document the value in the incident response runbook. Never change it after users register. |
| D1 storage limit reached | Low (10 GB is very large for encrypted passwords) | High (writes fail, new registrations blocked) | Monitor storage. Migrate to D1's paid tier higher limits if needed. |
| Cloudflare outage | Very Low | High (API completely down) | Cloudflare has a strong SLA. Keep the Fastify API code archived (not deleted) for emergency redeployment. |
| R2 export corruption | Very Low | Medium (users lose export backups) | R2 stores data with high durability. Exports are encrypted client-side, so integrity is also verified by the client. |

---

## Appendix A: Updated wrangler.toml (Complete Reference)

```toml
name = "zero-vault-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# ── Production (default) ─────────────────────────────────────────────────────

[vars]
ENVIRONMENT = "production"
CORS_ORIGIN = "https://vault.your-domain.com"

[[d1_databases]]
binding = "DB"
database_name = "zero-vault-db"
database_id = "<production-d1-id>"

[[r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports"

# ── Staging ────────────────────────────────────────────────────────────────────

[env.staging]
name = "zero-vault-api-staging"

[env.staging.vars]
ENVIRONMENT = "staging"
CORS_ORIGIN = "https://staging-vault.your-domain.com"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "zero-vault-db-staging"
database_id = "<staging-d1-id>"

[[env.staging.r2_buckets]]
binding = "R2"
bucket_name = "zero-vault-exports-staging"

# ── Preview (PR deployments) ──────────────────────────────────────────────────

[env.preview]
name = "zero-vault-api-preview"

[env.preview.vars]
ENVIRONMENT = "preview"
CORS_ORIGIN = "https://preview-vault.your-domain.com"
```

## Appendix B: Files to Remove After Migration

After Phase 3 is complete:

- `apps/api/` (entire directory)
- `apps/api/prisma/` (schema and migrations)
- `docker-compose.yml` PostgreSQL service (keep other services if any)
- Root `package.json` `dev:api` script
- `docs/deployment.md` PostgreSQL sections (keep Cloudflare sections)

## Appendix C: Post-Migration Checklist

- [ ] D1 production database created and migrations applied.
- [ ] R2 production bucket created.
- [ ] All Worker secrets set (`SESSION_SECRET`, `OPAQUE_SERVER_SETUP`, `MAINTENANCE_TOKEN`).
- [ ] Custom domain configured and TLS active.
- [ ] Web Vault `NEXT_PUBLIC_API_URL` points to Worker API.
- [ ] Extension API endpoint points to Worker API.
- [ ] Existing user data migrated from PostgreSQL to D1 (if applicable).
- [ ] Login tested with migrated users.
- [ ] Registration tested for new users.
- [ ] Vault sync (push + pull) tested.
- [ ] Item-level sync tested.
- [ ] Recovery packet tested.
- [ ] Device trust flow tested.
- [ ] Export (R2) create/download/delete tested.
- [ ] Maintenance endpoint tested.
- [ ] Health and readiness endpoints verified.
- [ ] CI/CD pipeline deploys to staging automatically.
- [ ] CI/CD pipeline deploys to production with manual approval.
- [ ] D1 backup cron configured.
- [ ] External uptime monitoring configured.
- [ ] Cloudflare error rate alerts configured.
- [ ] Incident response runbook updated with Worker-specific procedures.
