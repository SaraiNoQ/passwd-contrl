# Obscura Desktop

macOS desktop app for Zero Vault / Obscura. Built with Tauri 2.x + React + TypeScript.

## Current status

- Native adapters are wired for production startup: Rust crypto-core via Tauri IPC, macOS Keychain, and local SQLite ciphertext cache.
- Main app orchestration is in place for login, forge/unlock, dashboard, credentials, CSV import, recovery code, sync/conflicts, device trust, settings, menu shortcuts, and lock/logout.
- The desktop UI follows the current Web Vault Obscura style reference: Cloud Mist canvas, Paper White panels, Signal Orange accents, Jersey 10 display type, Manrope UI text.
- Remaining MVP work: Rust-side key custody, complete conflict resolution semantics, persistent offline mutation queue, lifecycle/native smoke testing, and release packaging. Signing/notarization and Credential Provider are outside the current MVP.

## Commands

Run from the repository root:

```sh
pnpm --filter @zero-vault/desktop dev
pnpm --filter @zero-vault/desktop typecheck
pnpm --filter @zero-vault/desktop test
pnpm --filter @zero-vault/desktop build
```

Run the native window with:

```sh
pnpm --dir apps/desktop exec tauri dev
```

The desktop app expects the Worker API during local auth/sync development:

```sh
pnpm --filter @zero-vault/worker-api dev
```

## API URL / CSP

The Content-Security-Policy `connect-src` directive is configured via the `ZERO_VAULT_API_URL` environment variable at Tauri build time. Set it before running or building the native app:

```sh
# Development
ZERO_VAULT_API_URL=http://localhost:8787 pnpm --dir apps/desktop exec tauri dev

# Production build
ZERO_VAULT_API_URL=https://api.zerovault.example pnpm --dir apps/desktop exec tauri build
```

If `ZERO_VAULT_API_URL` is not set, Tauri will fail to resolve the CSP and the app will not start.

## Documentation

Desktop development specifications live in `docs/mac-dev/`.

Key files:

- `docs/mac-dev/overview.md` — scope and technology choices.
- `docs/mac-dev/architecture.md` — Tauri/React/Rust data flow.
- `docs/mac-dev/code-sharing.md` — strict Web/Desktop isolation rules.
- `docs/mac-dev/ui-interaction.md` — desktop information architecture and UI behavior.
- `docs/mac-dev/security.md` — security requirements.
- `docs/mac-dev/quality.md` — verification gate.
