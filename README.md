# Zero Vault

Zero Vault is a zero-knowledge password manager for Web Vault, browser extension autofill, and future Android/iOS/macOS clients.

The server never sees your master password, derived keys, or plaintext vault contents. All encryption happens client-side.

## Current Status

Phases 1-5 are implemented locally. The backend is the Cloudflare Worker API (`apps/worker-api`) with local D1/R2 simulation.

- **Phase 1 (Crypto Core):** Complete. Rust Argon2id + XChaCha20-Poly1305 via `crypto-core`, WASM exports, Web Vault create/unlock/lock, CSV import.
- **Phase 2 (API + Sync):** Complete. OPAQUE auth, HttpOnly cookies, CSRF, whole-envelope sync, D1 storage.
- **Phase 3 (Extension MVP):** Complete. MV3, form detection, confirmed fill, HTTPS-only, phishing protection, E2E tests.
- **Phase 4 (Item-Level Sync):** Complete locally. Per-item encrypted sync, revision conflicts, conflict resolution UI, and history are implemented.
- **Phase 5 (Recovery + Device Trust + Worker API):** Complete locally. Recovery packets, device trust, D1/R2 Worker API, rate limiting, redacted logging, and readiness endpoints are implemented.
- **Phase 6 (Mobile):** Planned. Android/iOS crypto reuse via UniFFI.

See [docs/release-gate.md](./docs/release-gate.md) for the full launch readiness checklist.

## Quick Start

```sh
npx pnpm install
npx pnpm --filter @zero-vault/worker-api db:migrate
npx pnpm dev:worker
npx pnpm dev:web
```

No Docker is required for local development. The Worker API uses Wrangler's local D1/R2 simulation. For local Web Vault development, `apps/web/.env.local` should contain:

```sh
NEXT_PUBLIC_API_URL=http://localhost:8787
```

To build the Rust WASM crypto package:

```sh
npx pnpm wasm:build
```

See [docs/rust-environment.md](./docs/rust-environment.md) for Rust/wasm-pack setup.

To build the browser extension:

```sh
npx pnpm dev:extension
```

Then load `apps/extension` as an unpacked extension in Chrome/Edge. Set `NEXT_PUBLIC_EXTENSION_ID` in `.env.local` to the extension ID shown by the browser.

## Architecture

```
apps/web           - Web Vault (Next.js)
apps/extension     - Manifest V3 browser extension
apps/worker-api    - Cloudflare Worker API (Hono + D1 + R2)
packages/shared    - DTOs and validation schemas
crates/crypto-core - Rust KDF and AEAD primitives
```

**Data flow:** Clients derive keys locally, encrypt items locally, send only ciphertext to the API. The API stores encrypted envelopes. Other clients pull ciphertext and decrypt locally after unlock.

**Item-level sync (Phase 4):** Each vault item is encrypted with its own key. The client sends a sync plan with per-item upserts and deletes. The server returns conflicts for resolution. The server never sees plaintext.

See [docs/architecture.md](./docs/architecture.md) for details.

## Security Principles

- The server must never receive the master password.
- The server must never be able to decrypt vault items.
- Password import must parse plaintext only in client memory and immediately encrypt before sync.
- Autofill requires user confirmation by default and never fills hidden, cross-origin, or insecure fields.
- Recovery codes are never sent to the server.
- Device trust uses per-device keypairs; the server stores encrypted vault keys it cannot decrypt.

See [AGENT.md](./AGENT.md) and the documents in [docs/](./docs) before changing security-sensitive code.

## Cloudflare Deployment

Zero Vault deploys on Cloudflare Workers with D1 (database) and R2 (object storage).

```sh
# Create D1 database
cd apps/worker-api
npx wrangler d1 create zero-vault-db

# Apply migrations
npx wrangler d1 migrations apply zero-vault-db

# Set secrets
npx wrangler secret put SESSION_SECRET
npx wrangler secret put OPAQUE_SERVER_SETUP
npx wrangler secret put MAINTENANCE_TOKEN

# Deploy
npx wrangler deploy
```

See [docs/cloudflare-deployment.md](./docs/cloudflare-deployment.md) for the full guide including R2 setup, custom domains, and monitoring.

See [docs/migration-risk-checklist.md](./docs/migration-risk-checklist.md) for risks and mitigations when moving from PostgreSQL to D1.

## Documentation

- [Architecture](./docs/architecture.md) - Component overview and data flow
- [Security Model](./docs/security-model.md) - Key hierarchy, dual runtime, encryption model
- [Threat Model](./docs/threat-model.md) - Threats and mitigations
- [Sync Protocol](./docs/sync-protocol.md) - Whole-envelope and item-level sync
- [Recovery](./docs/recovery.md) - Recovery code generation and flow
- [Device Trust](./docs/device-trust.md) - Multi-device access and approval
- [Autofill](./docs/autofill.md) - Fill rules, phishing protection, field checks
- [Import](./docs/import.md) - CSV import flow and security
- [Development](./docs/development.md) - Local setup, testing, extension dev
- [Deployment](./docs/deployment.md) - Cloudflare Workers, env vars, extension publishing
- [Cloudflare Deployment](./docs/cloudflare-deployment.md) - Workers, D1, R2 setup and deployment
- [Migration Risk Checklist](./docs/migration-risk-checklist.md) - Risks and mitigations for Cloudflare migration
- [Release Checklist](./docs/release-checklist.md) - Pre-release verification
- [Incident Response](./docs/incident-response.md) - Security incident procedures
- [Release Gate](./docs/release-gate.md) - Launch readiness checklist
- [Roadmap](./docs/roadmap.md) - Phase status and plan
- [Rust Environment](./docs/rust-environment.md) - Rust/wasm-pack setup and teardown
