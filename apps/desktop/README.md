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

## Documentation

Desktop development specifications live in `docs/mac-dev/`.

Key files:

- `docs/mac-dev/overview.md` — scope and technology choices.
- `docs/mac-dev/architecture.md` — Tauri/React/Rust data flow.
- `docs/mac-dev/code-sharing.md` — strict Web/Desktop isolation rules.
- `docs/mac-dev/ui-interaction.md` — desktop information architecture and UI behavior.
- `docs/mac-dev/security.md` — security requirements.
- `docs/mac-dev/quality.md` — verification gate.
