# Development

Last updated: 2026-06-04

## Local Setup

```sh
npx pnpm install
npx pnpm dev:worker
npx pnpm dev:web
```

No Docker is required for local development. The Worker API uses Wrangler's local D1/R2 simulation.

### Running the Worker API locally

```sh
cd apps/worker-api
npx pnpm dev
```

This starts `wrangler dev`, which runs the Worker locally with a local D1 database. The local D1 database is created automatically and migrations from `apps/worker-api/migrations/` are applied.

The local Worker API listens on `http://localhost:8787` by default.

### Running D1 migrations locally

D1 migrations run automatically when `wrangler dev` starts. To apply them manually against the local database:

```sh
cd apps/worker-api
npx wrangler d1 migrations apply zero-vault-db --local
```

To apply against the remote (production) database:

```sh
npx wrangler d1 migrations apply zero-vault-db
```

### Full stack with Worker API

Run all three apps together:

```sh
# Terminal 1: Worker API (Cloudflare Workers)
cd apps/worker-api && npx pnpm dev

# Terminal 2: Web Vault
npx pnpm dev:web

# Terminal 3: Extension (after Web Vault is running)
npx pnpm dev:extension
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8787` in `apps/web/.env.local` to point the Web Vault at the local Worker API.

### Worker API tests

```sh
cd apps/worker-api
npx pnpm test
```

## Running Tests

### TypeScript Type Checking

```sh
npx pnpm typecheck
```

### Unit Tests (TypeScript)

```sh
npx pnpm test
```

### Rust Tests

```sh
cargo test --manifest-path crates/crypto-core/Cargo.toml
```

Or use the pnpm shortcut:

```sh
npx pnpm test:rust
```

### WASM Build

```sh
npx pnpm wasm:build
```

Build or refresh the Rust WASM package after installing Rust and `wasm-pack`. See `docs/rust-environment.md` for install, verification, and uninstall procedure.

### E2E Tests (Extension)

```sh
npx pnpm test:e2e
```

### All Tests

```sh
npx pnpm test:all
```

This runs both TypeScript tests and Rust tests.

## UI Development

The Web Vault UI uses a dark theme design system defined in `apps/web/app/tokens.css`. Design tokens (colors, spacing, radius, typography, shadows) are CSS custom properties consumed by CSS Modules in `apps/web/components/ui/`.

### Running the UI dev server

```sh
npx pnpm dev:web
```

Open `http://localhost:3000` to view changes. The dev server supports hot reload.

### Verifying UI changes

After modifying UI components or tokens:

```sh
npx pnpm --filter @zero-vault/web typecheck
npx pnpm --filter @zero-vault/web test
```

### Design token reference

All design tokens are defined in `apps/web/app/tokens.css`. Key token groups:

- **Background**: `--color-bg-root` (#050B12), `--color-bg-shell` (#07111D), `--color-bg-panel` (#0B1624)
- **Status colors**: `--color-primary` (cyan), `--color-success` (mint), `--color-warning` (amber), `--color-danger` (rose)
- **Spacing**: `--space-1` (4px) through `--space-8` (32px)
- **Radius**: `--radius-sm` (6px), `--radius-md` (8px), `--radius-lg` (12px)
- **Glass**: `--glass-bg`, `--glass-border` for panel glassmorphism effects

### Chinese text testing notes

The default language is zh-CN. When testing UI changes:

- All visible interface text must be in Chinese.
- Button labels should be 2-6 Chinese characters.
- Error messages must be in Chinese and must not leak internal implementation details.
- No stray English placeholder text should remain in any component.
- Test with long Chinese strings to verify no overflow in narrow containers (extension popup, mobile viewports).

## Extension Development

Build the extension:

```sh
npx pnpm dev:extension
```

Then load `apps/extension` as an unpacked extension in Chrome or Edge after the TypeScript build emits `dist`.

To let Web Vault publish unlocked credentials to the extension during local development:

1. Load the unpacked extension in Chrome/Edge.
2. Copy the extension ID shown by Chrome/Edge (e.g., `chrome://extensions`).
3. Set `NEXT_PUBLIC_EXTENSION_ID` in `.env.local` to that ID.
4. Restart the Web dev server.

This id is currently manual; changing or reloading the unpacked extension may require updating `.env.local` and restarting the Web dev server.

For manual extension validation, serve `apps/extension/fixtures/https-login.html` over local HTTPS and confirm that the popup shows exact-origin credentials only after Web Vault is unlocked.

## Web Vault

The Web Vault can create and unlock a local encrypted vault at `http://localhost:3000`. It stores only the encrypted envelope under `zero-vault.local.encrypted-vault.v1` in browser `localStorage`.

New local vaults use the generated `crypto-core-wasm` runtime. Legacy `webcrypto-mvp` vaults remain compatible and are re-sealed in their original format rather than migrated implicitly.

Phase 2 sync stores that encrypted local vault as one cloud envelope. A signed-in device with no local vault can restore the encrypted envelope from cloud storage, then unlock it locally.

With item-level sync (Phase 4), each vault item is synced individually with per-item encryption.

CSV import is available in the Web Vault after unlock. The CSV file is read in browser memory, converted into vault entries, and encrypted before persistence. Delete the plaintext CSV after import.

## API

Phase 2 sync endpoints require an OPAQUE-authenticated session cookie. Web requests must include the CSRF token returned by `/auth/login/finish` for non-GET sync writes.

The Worker API uses D1 (SQLite) for all persistent storage. Local development uses Wrangler's built-in D1 simulation.

## Commit Guidelines

Use concise conventional commits:

- `feat(web): add vault unlock screen`
- `feat(extension): add confirmed fill picker`
- `fix(api): reject stale sync revisions`
- `docs(security): update recovery threat model`

## Dependency Rules

- Prefer maintained packages with clear security posture.
- Do not add cryptographic packages without documenting why.
- Review extension permission changes in `docs/autofill.md`.
- Review server authentication changes in `docs/security-model.md`.
