# Roadmap

Last updated: 2026-06-08

Current target: a stable Web Vault + Chrome/Edge extension development build. Do not treat the current repository as production-ready.

## Phase Status

| Phase | Status | Completed | Current limits | Next step |
| --- | --- | --- | --- | --- |
| Phase 0: Project Foundation | Complete | Monorepo, project docs, CI/check expectations, package scripts. | None specific to this phase. | Keep docs aligned with security-sensitive changes. |
| Phase 1: Crypto Core | Complete | Rust Argon2id + XChaCha20-Poly1305 via `crypto-core`, WASM exports, Web Vault create/unlock/lock, encrypted local persistence, CSV import. | Legacy `webcrypto-mvp` vaults remain compatible but are not automatically migrated. | Add explicit user-confirmed legacy vault migration only if needed. |
| Phase 2: API + Sync | Complete | OPAQUE auth, HttpOnly session cookies, CSRF checks, D1 storage, revision conflicts, history, Web sync push, encrypted cloud restore, whole-envelope sync. | Whole-envelope sync is the legacy path. | Superseded by item-level sync as the new default. |
| Phase 3: Extension MVP | Complete | MV3 background/content/popup, form detection, confirmed fill, HTTPS-only origin matching, visible-field checks, cross-origin iframe blocking, session bridge, E2E tests. | `NEXT_PUBLIC_EXTENSION_ID` is manually configured. Chrome/Edge compatibility needs manual validation before release. | Harden browser E2E and document browser-specific restrictions. |
| Phase 4: Item-Level Sync | Complete | Per-item encrypted sync backend, conflict detection, recovery codes, device trust backend, conflict resolution UI, device management UI, sync panel with activity log, ECDH device trust (X25519 keypair generation, vault key encryption/decryption, IndexedDB private key storage), device vault key sharing via `POST /devices/:id/share-key`. | Recovery flow end-to-end not manually verified. | Manual E2E verification. |
| UI Refactor (UI-1 through UI-6) | Complete | Design system tokens, full component library, Web Shell (sidebar, top bar, locked state), credential workspace (sorting, strength, batch ops), CSV import wizard (5-step), recovery flow (3-step wizard + entry), sync/device page, conflict resolution, settings page, responsive layout, mobile navigation, ARIA accessibility. | None. | None. |
| Phase 5: Production | Complete | Security audit completed, 299 tests passing, TypeScript clean, Worker API deployed to Cloudflare with D1/R2. Unified Worker API architecture: OPAQUE works in Workers via static WASM import. D1-backed rate limiting implemented. Browser E2E tests passing (vault creation, credential CRUD, search, password generator). Full Worker API route test coverage (vault, recovery, devices, auth). | npm audit has 12 vulnerabilities (mostly dev-only). | Upgrade vitest, add staging environment. |
| Phase 6: Mobile | In Progress | Expo + TypeScript scaffold (`apps/mobile`), Expo Router, dark theme, 6 MVP screens, MobileApiClient, MobileCryptoAdapter (test double), MobileSecureStore, MobileCiphertextStore, MobileSyncService, auth/vault state management, 25 unit tests passing. | MVP uses test double crypto (not real crypto-core). OPAQUE login requires WASM port to RN. In-memory stores (not SQLite/SecureStore). No Android Autofill or iOS Credential Provider. | Wire real crypto-core via UniFFI/Expo native module. Implement OPAQUE client for RN. Add SQLite persistence. |
| Phase 7: Desktop | Complete | Tauri 2.x + React macOS desktop app, full feature parity with web, 193+ tests passing. | None. | Notarization and DMG distribution. |

## Phase 0: Project Foundation

- Initialize monorepo.
- Add `AGENT.md`.
- Add architecture, security, autofill, import, development, and threat-model docs.
- Add CI skeleton and dependency audit expectations.

## Phase 1: Crypto Core

- Rust `crypto-core` WASM exports are present and can be built with the local Rust/`wasm-pack` toolchain.
- Web Vault create/unlock/lock and encrypted local persistence are implemented.
- CSV import is implemented in Web Vault after unlock.
- New Web Vaults default to `crypto-core-wasm` using Argon2id and XChaCha20-Poly1305.
- Legacy `webcrypto-mvp` vaults remain unlockable and are re-sealed in their original format.
- Current limitation: there is no automatic legacy-to-WASM migration.

## Phase 2: API + Sync

- D1 storage schema is implemented.
- OPAQUE registration/login, session cookies, and CSRF checks are implemented.
- Encrypted vault items, revisions, item history, conflict handling, and Web Vault sync entrypoints are implemented.
- Phase 2 MVP sync stores the Web local vault as one encrypted envelope item (whole-envelope sync).
- Cloud restore for the encrypted vault envelope is implemented when a signed-in device has no local vault.
- Whole-envelope sync remains supported for backward compatibility but is superseded by item-level sync as the default.

## Phase 3: Extension MVP

- Extension connects to Web Vault unlocked-session state through the session bridge.
- Multi-credential popup picker and confirmed fill are implemented.
- CSV import lives in Web Vault, not the extension popup.
- Phishing protections include exact HTTPS origin matching, similar-origin warnings, suspicious-origin blocking, no automatic submit, user confirmation, and blocking hidden, disabled, readonly, HTTP, and iframe fills.
- Extension MVP supports exact HTTPS origin matching only. Wider eTLD+1 suggestions are deferred.
- Field visibility re-checks are performed before fill to guard against DOM mutations.
- Cross-origin iframe fills are blocked.
- Current limitation: `NEXT_PUBLIC_EXTENSION_ID` must be manually configured to the unpacked Chrome/Edge extension id.
- E2E tests cover the core popup picker and fill flows.

## Phase 4: Item-Level Sync

- Per-item encrypted sync replaces whole-envelope sync as the default sync path.
- Client sends `ItemLevelSyncPlan` with per-item upserts and deletes.
- Each upsert includes `baseItemRevision` for conflict detection.
- Server returns `ItemLevelSyncResponse` with applied IDs and conflicts.
- Client resolves conflicts via UI: keep local, accept remote, create copy, or skip.
- Pull returns all items as ciphertext plus `serverRevision`.
- Recovery codes: 256-bit random, base64url encoded, derive recovery key via Argon2id, encrypt vault key with AES-GCM. Code is never sent to server.
- Device trust: X25519 ECDH keypair per device, approval flow for new devices, revocation support.
- ECDH integration: `generateDeviceKeypair()` generates 64-byte WASM output (private || public), private key stored in IndexedDB, public key in localStorage and sent to server.
- `encryptVaultKeyForDevice()` encrypts vault key with device public key via WASM; `decryptVaultKeyOnDevice()` decrypts using IndexedDB private key.
- Device approval flow: approver encrypts vault key for new device and stores via `POST /devices/:id/share-key`.
- Server stores encrypted vault key per device but cannot decrypt.

## UI Refactor (UI-1 through UI-6)

The UI refactor transforms the Web Vault and browser extension into a dark-themed, default zh-CN security console. This work runs in parallel with Phase 4 and is tracked in detail in `docs/ui-development.md`.

- **UI-1 (Complete):** Design system foundation. Tokens defined in `tokens.css` (colors, spacing, radius, typography, shadows, glass). All design system components built and used: Button, Input, PasswordField, Badge, Panel, Drawer, Modal, Toast, CredentialRow.
- **UI-2 (Complete):** Web Shell and locked state. Sidebar (`sidebar.tsx`), top status bar (`top-bar.tsx`), locked dashboard (`locked-state.tsx`), extension connection status.
- **UI-3 (Complete):** Credential workspace. Credential list with multi-field sorting, password strength visualization, batch operations (delete/export). Add/edit drawer. Search, filter, copy, password generator.
- **UI-4 (Not Started):** Extension popup. Chinese status text, candidate picker, confirmed fill, blocking reasons.
- **UI-5 (Complete):** Import, recovery, sync and device UI. 5-step CSV import wizard with preview/validation. 3-step recovery code wizard with print and verification. Sync panel with activity log. Device management with approve/reject/revoke. Conflict resolution with side-by-side comparison. Settings page (auto-lock, extension ID, master password change, account delete, CSV/encrypted export, auto-sync toggle).
- **UI-6 (Complete):** Responsive layout and accessibility. Mobile bottom navigation (768px breakpoint). ARIA attributes on all interactive elements. Sidebar navigation with aria-current and aria-label. Locked state with role="region" and aria-label. App shell with role="application".

## Phase 5: Production

- Security audit completed (2026-06-04). Report at `docs/security-audit-report.md`.
- 299 tests passing across all workspaces. TypeScript clean.
- **Unified Worker API architecture:** OPAQUE works in Cloudflare Workers via custom static WASM import loader (`opaque-loader.ts`). All endpoints (auth + vault sync) handled by single Worker API.
- **OPAQUE WASM fix:** Custom `opaque-loader.ts` imports `opaque.wasm` statically (produces `WebAssembly.Module` in Workers), instantiates with proper WASM imports from the OPAQUE glue code, and exposes the server API.
- Worker API deployed to Cloudflare: `https://zero-vault-api.sarainosakura.workers.dev`
- D1 database (`2acefbf3-a4a8-4cd3-8549-03ccabb8307d`) with 3 migrations applied.
- R2 bucket (`zero-vault-exports`) created for exports.
- D1-backed rate limiting implemented (fail-open on D1 errors).
- Production secrets set: `OPAQUE_SERVER_SETUP`, `SESSION_SECRET`, `MAINTENANCE_TOKEN`.
- Browser E2E tests passing (Playwright + Chromium): vault creation, credential CRUD, search/filter, password generator.
- CSRF protection verified on all state-changing endpoints (x-zero-vault-csrf header).
- Rate limiting on auth endpoints (8 req/min registration, 10 req/min login).
- Session security: opaque tokens, SHA-256 server-side, HttpOnly/Secure/SameSite cookies.
- Cloudflare Workers migration plan documented in `docs/cloudflare-migration-plan.md`.
- Full Worker API route test coverage: vault sync (20 tests), recovery (9 tests), devices (22 tests), auth (18 tests).
- Device vault key sharing via `POST /devices/:id/share-key` route implemented.
- Remaining: upgrade vitest to >=4.1.0, add staging environment.

## Phase 6: Mobile

- **Status:** In Progress (MVP scaffold complete).
- **Scope:** React Native + Expo + TypeScript mobile client at `apps/mobile`.
- **Implemented:**
  - Expo managed workflow with Expo Router file-based routing.
  - Dark theme tokens independent from Web CSS (`src/theme/tokens.ts`).
  - 6 MVP screens: Login, Unlock, VaultList, CredentialDetail, SyncStatus, Settings.
  - MobileApiClient with `loginDirect`, `loginStart`, `loginFinish`, `fetchCurrentUser`, `logout`, `pullItems`, `pushItemLevelSync`.
  - MobileCryptoAdapter interface with test double (NOT for production).
  - MobileSecureStore with Expo SecureStore adapter and in-memory fallback.
  - MobileCiphertextStore with in-memory implementation.
  - MobileSyncService for item-level sync pull.
  - Auth state and vault state management with auto-lock.
  - 25 unit tests passing (API client, crypto adapter, ciphertext store, sync service).
- **Remaining (MVP):**
  - Wire real crypto-core via UniFFI/Expo native module (replace test double).
  - Implement OPAQUE client protocol for React Native (replace direct login).
  - Add SQLite persistence for ciphertext store.
  - Add expo-secure-store persistence for secure store.
  - Update `docs/mobile-development.md` Phase status.
- **Remaining (Post-MVP):**
  - Android AutofillService.
  - iOS/macOS Credential Provider Extension.
  - Rust crypto reuse through UniFFI bindings.
  - E2E smoke tests.
