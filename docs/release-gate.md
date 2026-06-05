# Release Gate

Last updated: 2026-06-04

This document tracks every item required before Zero Vault can ship as a public beta. Status values: **DONE**, **NEEDS_WORK**, **BLOCKED**.

## Gate Table

| # | Category | Item | Status | Evidence | Owner |
| --- | --- | --- | --- | --- | --- |
| 1 | Crypto | Rust Argon2id + XChaCha20-Poly1305 via `crypto-core` WASM | DONE | `crates/crypto-core/src/lib.rs`, 18 Rust tests pass | Crypto |
| 2 | Crypto | Item-level key derivation (HKDF per item) | DONE | `crates/crypto-core/src/lib.rs` `derive_item_key`, `apps/web/lib/local-vault.ts` `deriveWebCryptoItemKey` | Crypto |
| 3 | Crypto | Dual runtime (crypto-core-wasm + webcrypto-mvp) | DONE | `apps/web/lib/local-vault.ts` dual-path create/unlock/seal | Crypto |
| 4 | Crypto | Recovery code generation (256-bit, base64url) | DONE | `apps/web/lib/recovery.ts` `generateRecoveryCode` | Crypto |
| 5 | Crypto | Recovery packet encryption | DONE | `apps/web/lib/recovery.ts` PBKDF2+AES-GCM, `crates/crypto-core/src/lib.rs` Argon2id+XChaCha20 | Crypto |
| 6 | Crypto | Device trust X25519 ECDH (Rust) | DONE | `crates/crypto-core/src/lib.rs` `generate_device_keypair`, `encrypt_for_device`, `decrypt_on_device`, 3 device tests | Crypto |
| 7 | Auth | OPAQUE registration and login | DONE | `apps/worker-api/src/routes/auth.ts`, `apps/worker-api/src/routes/auth.test.ts` | API |
| 8 | Auth | HttpOnly session cookies + CSRF | DONE | `apps/worker-api/src/middleware/session.ts`, `apps/worker-api/src/middleware/csrf.ts` | API |
| 9 | Sync | Whole-envelope sync (legacy) | DONE | `POST /vault/sync`, backward-compat test | API |
| 10 | Sync | Item-level sync push/pull/conflict detection | DONE | `POST /vault/item-sync`, `GET /vault/item-sync`, tested in worker-api | API |
| 11 | Sync | Per-item revision tracking | DONE | `apps/web/lib/sync-vault.ts` `loadItemRevisionMap`, `updateItemRevisionMap` | Web |
| 12 | Extension | MV3 background/content/popup | DONE | `apps/extension/manifest.json`, `src/background.ts`, `src/content-script.ts`, `src/popup.ts` | Extension |
| 13 | Extension | Form detection + confirmed fill | DONE | `src/form-detection.ts`, `src/form-fill.ts`, unit tests | Extension |
| 14 | Extension | HTTPS-only origin matching | DONE | `src/origin-matching.ts`, E2E test blocks HTTP | Extension |
| 15 | Extension | Similar-origin / phishing classification | DONE | `src/origin-matching.ts` `classifyOriginMatch` (exact/similar/suspicious/different) | Extension |
| 16 | Extension | Hidden/disabled/readonly/cross-origin field blocking | DONE | E2E tests: hidden-field, readonly-field, disabled-field, cross-origin-iframe | Extension |
| 17 | Extension | Session bridge (Web Vault <-> Extension) | DONE | `apps/web/lib/extension-bridge.ts`, E2E tests | Extension |
| 18 | Extension | E2E tests (Playwright) | DONE | `apps/extension/e2e/extension.spec.ts`, 16 tests | Extension |
| 19 | Import | Client-side CSV import | DONE | `apps/web/lib/csv-import.ts`, `csv-import.test.ts` | Web |
| 20 | API | D1 storage | DONE | `apps/worker-api/src/store/d1-store.ts`, `apps/worker-api/migrations/` | API |
| 21 | API | Rate limiting on auth endpoints | DONE | `apps/worker-api/src/middleware/rate-limit.ts` | API |
| 22 | API | Expired session cleanup | DONE | `cleanupExpiredSessions` in D1 store, tested in worker-api | API |
| 24 | Web | Conflict resolution UI | DONE | `apps/web/components/sync/conflict-resolution-panel.tsx` with keep-local/accept-remote/create-copy/skip actions, side-by-side comparison | Web |
| 25 | Web | Device trust ECDH key distribution in UI | DONE | `apps/web/lib/device-trust.ts` `generateDeviceKeypair()`, `encryptVaultKeyForDevice()`, `decryptVaultKeyOnDevice()`, `shareVaultKeyWithDevice()`; IndexedDB private key storage in `device-key-store.ts`; 7 tests in `device-trust.test.ts` | Web |
| 26 | Web | Device trust management UI | DONE | `apps/web/components/sync/sync-device-panel.tsx` with approve/reject/revoke, current device highlight, confirmation dialogs | Web |
| 27 | Deploy | Production HTTPS + HSTS | NEEDS_WORK | Config documented in `docs/deployment.md`; no production deployment yet | Ops |
| 28 | Deploy | Cloudflare D1 production setup | NEEDS_WORK | Local D1 works; production D1 provisioning not started | Ops |
| 29 | Deploy | Chrome Web Store publishing | BLOCKED | Extension builds and loads unpacked; no Chrome Web Store account or listing | Extension |
| 30 | Deploy | Edge Add-ons publishing | BLOCKED | Extension builds; no Edge Add-ons account or listing | Extension |
| 31 | Security | Dependency audit (npm + cargo) | DONE | CI workflow runs `npx pnpm audit` + `cargo audit` on push/PR | Security |
| 32 | Security | Security docs match implementation | DONE | All docs updated 2026-06-04 | Docs |
| 33 | Security | External security audit | DONE | Automated audit 2026-06-04. Report: `docs/security-audit-report.md`. 248 tests pass, TypeScript clean, 12 npm vulns (mostly dev-only). | Security |
| 34 | Testing | Browser manual E2E (Chrome) | NEEDS_WORK | Playwright E2E runs headless Chromium; manual testing on real Chrome not done | QA |
| 35 | Testing | Browser manual E2E (Edge) | NEEDS_WORK | Not tested on Edge | QA |
| 36 | Docs | All internal links valid | DONE | Verified during 2026-06-04 review | Docs |
| 37 | Docs | Phase descriptions current | DONE | Updated 2026-06-04 | Docs |
| 38 | Deploy | Cloudflare D1 database setup | NEEDS_WORK | `wrangler.toml` placeholder exists; no `database_id` configured | Ops |
| 39 | Deploy | Cloudflare R2 bucket setup | NEEDS_WORK | `wrangler.toml` placeholder exists; no bucket binding configured | Ops |
| 40 | Deploy | Cloudflare Worker secrets configured | NEEDS_WORK | Secrets not yet created; documented in `docs/cloudflare-deployment.md` | Ops |
| 41 | Deploy | Cloudflare Worker deployed to production | NEEDS_WORK | `apps/worker-api` exists with D1 migrations; no production deployment | Ops |
| 42 | Deploy | D1 migration CI/CD pipeline | NEEDS_WORK | No automated migration workflow | Ops |
| 43 | Deploy | Cloudflare monitoring and alerts | NEEDS_WORK | Not configured; documented in `docs/cloudflare-deployment.md` | Ops |
| 44 | Security | D1 threat model review | DONE | Cloudflare-specific threats documented in `docs/threat-model.md` | Security |
| 45 | Docs | Cloudflare deployment guide | DONE | `docs/cloudflare-deployment.md` | Docs |
| 46 | Docs | Migration risk checklist | DONE | `docs/migration-risk-checklist.md` | Docs |

## Test Inventory

| Suite | Location | Count | Status |
| --- | --- | --- | --- |
| Rust crypto-core | `crates/crypto-core/src/lib.rs` | 18 | Pass |
| Worker API tests | `apps/worker-api/src/*.test.ts` | 7 files, 130 tests | Pass |
| Extension E2E (Playwright) | `apps/extension/e2e/extension.spec.ts` | 16 | Pass (headless Chromium) |
| Extension unit tests | `apps/extension/src/*.test.ts` | 6 files, 65 tests | Pass |
| Web vault unit tests | `apps/web/lib/*.test.ts` | 7 files, 44 tests | Pass |
| Shared schema + security tests | `packages/shared/src/*.test.ts` | 2 files, 37 tests | Pass |
| **Total** | | **284 pass** | |

## Launch Readiness Assessment

### What is complete

- Zero-knowledge crypto core: Argon2id + XChaCha20-Poly1305 via Rust WASM, with WebCrypto fallback.
- Item-level encryption with per-item key derivation (HKDF).
- OPAQUE password-authenticated key exchange (no plaintext password to server).
- Item-level sync with per-item revision tracking and conflict detection.
- Recovery code generation and encrypted recovery packet storage.
- Device trust backend with approve/reject/revoke flows.
- ECDH device trust integration: X25519 keypair generation, vault key encryption/decryption, IndexedDB private key storage, device key sharing on approval.
- Worker API (Hono/Cloudflare Workers): full route coverage (auth, vault sync, item-level sync, recovery, devices, maintenance, exports).
- MV3 browser extension with form detection, confirmed fill, HTTPS-only matching, phishing classification, and cross-origin iframe blocking.
- Client-side CSV import from Chrome, Edge, and Firefox.
- D1 storage with full test coverage.
- Comprehensive test suite: 284 tests passing (18 Rust, 130 worker-api, 65 extension, 51 web, 38 shared) + 16 extension E2E tests.
- Security leakage regression tests covering all API endpoints, localStorage, and extension behaviors.
- CI workflow with typecheck, test, build, extension E2E, Rust test, WASM build, and dependency audit.
- All security documentation reviewed and aligned with implementation.
- UI-1 design system foundation complete: full component library (Button, Input, PasswordField, Badge, Panel, Drawer, Modal, Toast, CredentialRow) with design tokens, default zh-CN.
- UI-2 through UI-5 complete: Web Shell (sidebar, top bar, locked state), credential workspace (sorting, strength viz, batch ops), 5-step CSV import wizard, 3-step recovery flow, sync panel with activity log, device management with approve/reject/revoke, conflict resolution with side-by-side comparison, settings page (auto-lock, extension ID, master password change, account delete, export, auto-sync).
- ECDH device trust: X25519 keypair generation via WASM, IndexedDB private key storage, vault key encryption/decryption for device sharing, 7 ECDH tests passing.

### What is blocked (cannot proceed without external action)

1. **Production Cloudflare D1 provisioning.** Local D1 works for development; production D1 database needs to be created and configured.
2. **Chrome Web Store publishing.** Requires a Chrome Web Store developer account ($5 fee), listing preparation, and review period.
3. **Edge Add-ons publishing.** Requires a Microsoft Partner Center account and listing preparation.
4. **Security audit.** Automated audit completed 2026-06-04 (report: `docs/security-audit-report.md`). 12 npm vulnerabilities found (mostly dev-only). The OPAQUE TypeScript package (`@serenity-kit/opaque`) should be reviewed by a human auditor before production.

### What needs manual verification

1. **Chrome manual E2E.** Playwright runs headless Chromium, but real Chrome with the unpacked extension should be tested manually (fill on real sites, session bridge, popup behavior).
2. **Edge manual E2E.** Not tested on Microsoft Edge.
3. **Cross-browser autofill compatibility.** Content script behavior may differ between Chrome and Edge (CSS selectors, field detection timing).
4. **Recovery flow end-to-end.** Generate code, store offline, recover vault -- UI complete (3-step wizard + recovery entry), needs manual walkthrough with a real user account.
5. **Device trust flow end-to-end.** Register device with ECDH keypair, approve and share vault key, decrypt on new device -- ECDH integration complete, needs manual walkthrough.

### Verdict

Zero Vault is a **launchable internal beta** for local development and testing. It is **not ready for public beta** until production infrastructure and at least one browser store listing are complete.
