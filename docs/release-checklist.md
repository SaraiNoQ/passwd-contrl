# Release Checklist

Last updated: 2026-06-04

Complete all items before any production release or public-facing deployment.

## Tests

- [ ] All tests pass (typecheck, unit, E2E, Rust, WASM)
  - `npx pnpm typecheck`
  - `npx pnpm test`
  - `npx npx pnpm test:e2e`
  - `npx npx pnpm test:rust`
  - `npx pnpm wasm:build`

## Security

- [ ] No plaintext in localStorage, logs, API payloads, or test fixtures
- [ ] Dependency audit passes
  - `npm audit` (no critical/high vulnerabilities)
  - `cargo audit` (no known vulnerabilities in Rust dependencies)
- [ ] Extension permission audit: minimal permissions only, no broad host access
- [ ] Security docs updated to match implementation
  - `docs/security-model.md`
  - `docs/threat-model.md`
  - `docs/autofill.md`
  - `docs/import.md`
  - `docs/recovery.md`
  - `docs/device-trust.md`

## Database

- [ ] D1 migrations tested on a clean local database
- [ ] Migration is reversible or documented as irreversible
- [ ] Backup/restore drill completed successfully

## Browser Extension

- [ ] Chrome manual E2E validation complete
- [ ] Edge manual E2E validation complete
- [ ] Extension loads as unpacked and as published package
- [ ] Session bridge works between Web Vault and extension
- [ ] Phishing protection tested (exact, similar, suspicious origins)

## API

- [ ] Rate limiting verified for auth and sync endpoints
- [ ] Session cleanup verified (expired sessions are removed)
- [ ] CSRF protection verified for all non-GET writes
- [ ] CORS configuration verified (no wildcards in production)

## Recovery and Device Trust

- [ ] Recovery code flow tested end-to-end
  - Generate code, store offline, recover vault
- [ ] Device trust flow tested end-to-end
  - Register device, approve from existing device, revoke device

## Documentation

- [ ] All internal links in docs are valid
- [ ] No references to removed features
- [ ] Phase descriptions are current
- [ ] Environment variable documentation matches actual config
