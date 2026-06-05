# Migration Risk Checklist

Last updated: 2026-06-04

This document identifies risks specific to deploying Zero Vault on Cloudflare Workers with D1 and R2, along with mitigations for each.

## Risk Table

| # | Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- | --- |
| 1 | D1 transaction limitations | Concurrent writes to the same row may conflict or fail. D1 supports transactions but has lower concurrency limits than PostgreSQL. | Medium | Use revision-based optimistic locking (already implemented in item-level sync). Each upsert checks `baseItemRevision` before applying. Conflicts are returned to the client for resolution. |
| 2 | Worker 30-second CPU time limit | Long-running operations (e.g., large sync plans with many items) may hit the CPU limit and timeout. | Medium | Chunk large sync plans into smaller batches on the client side. The Worker should process items in bounded loops and return partial results if needed. Monitor CPU usage via `wrangler tail`. |
| 3 | R2 eventual consistency | R2 provides strong consistency for individual operations, but bulk list operations may reflect recent writes with a slight delay. | Low | D1 is the source of truth for sync state. R2 is used only for export bundle storage. Read-after-write for exports uses the object key directly (strongly consistent for single-object reads). |
| 4 | Session cookie domain mismatch | Cookies set on a `workers.dev` subdomain do not propagate to a custom domain, and vice versa. Cross-subdomain sessions fail silently. | Medium | Configure the session cookie domain explicitly in the Worker. Use the same domain for the Worker API and the Web Vault, or configure cookie domain to cover both (e.g., `.your-domain.com`). Test cookie behavior after any domain change. |
| 5 | OPAQUE in Worker runtime | The `@serenity-kit/opaque` package uses WASM internally. Worker runtime WASM support may have edge cases not present in Node.js. | Medium | Test OPAQUE registration and login flows end-to-end on Cloudflare Workers before deploying to production. Run `wrangler dev` locally first. Monitor error rates after deployment. |
| 6 | Rate limiting without KV | Worker in-memory rate limiting resets on every cold start. Each Worker instance maintains its own counter. | High | Use D1-backed rate limiting instead of in-memory counters. Store rate limit state in a D1 table with TTL-based expiry. Alternatively, use Cloudflare's built-in rate limiting rules (available in the dashboard). |
| 7 | D1 storage limits | D1 has a 10 GB database size limit on the Workers Paid plan. Large vault histories or many users could approach this limit. | Low | Monitor D1 storage via the dashboard. Implement cleanup jobs to prune old `vault_item_history` rows. Set up alerts before reaching 80% of the limit. |
| 8 | R2 bucket permission scope | If the R2 bucket is misconfigured with public access, encrypted export bundles could be downloadable by anyone with the URL. | Low | R2 buckets are private by default. Do not enable public access. Use signed URLs with short expiry for export downloads. Audit bucket settings after initial setup. |
| 9 | Cloudflare account compromise | An attacker with access to the Cloudflare account can read D1 data, R2 objects, Worker secrets, and deploy malicious Worker code. | Low | Enable 2FA on the Cloudflare account. Use Cloudflare API tokens with minimal permissions for CI/CD. Restrict `wrangler` access to trusted developers. Audit account access logs periodically. |
| 10 | Worker environment variable exposure | Variables in `[vars]` are visible in the Cloudflare dashboard and in `wrangler.toml` (which is committed to the repo). | Low | Only put non-secret values in `[vars]`. Use `wrangler secret put` for all secrets. Review `wrangler.toml` before committing to ensure no secrets are included. |

## D1 vs PostgreSQL Differences

When migrating from the PostgreSQL deployment to D1, note these behavioral differences:

| Feature | PostgreSQL | D1 (SQLite) |
| --- | --- | --- |
| Transactions | Full ACID, high concurrency | Supported, lower concurrency limits |
| JSON columns | Native `jsonb` type | Stored as TEXT, parsed in application |
| Max database size | Depends on hosting | 10 GB (Workers Paid plan) |
| Full-text search | `tsvector` / `tsquery` | `FTS5` extension (not yet used) |
| Connection pooling | Required (PgBouncer, Prisma) | Not applicable (serverless) |
| Migrations | Prisma migrate | Wrangler D1 migrations (raw SQL) |

## Pre-Migration Checklist

Before migrating from PostgreSQL to D1:

- [ ] Verify all SQL queries are compatible with SQLite syntax.
- [ ] Verify JSON column handling works with TEXT storage.
- [ ] Run the full test suite against a local D1 database (`wrangler dev`).
- [ ] Test OPAQUE registration and login on Workers.
- [ ] Test item-level sync with concurrent writes from multiple devices.
- [ ] Test rate limiting under load.
- [ ] Verify session cookie behavior with the target domain.
- [ ] Back up the PostgreSQL database before switching over.

## Post-Migration Checklist

After deploying to Cloudflare:

- [ ] Monitor Worker error rates for 24 hours.
- [ ] Monitor D1 query performance and row counts.
- [ ] Verify R2 export uploads and downloads work.
- [ ] Test recovery flow end-to-end on Workers.
- [ ] Test device trust flow end-to-end on Workers.
- [ ] Verify CORS from the deployed Web Vault origin.
- [ ] Check `wrangler tail` for any unexpected errors or warnings.
