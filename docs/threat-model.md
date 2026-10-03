# Threat Model

## Extension capture and independent sessions (2026-10-03)

Treat content-script messages and captured form values as untrusted. Privileged vault operations require the extension's sender ID and exact top-level popup URL; save-prompt operations additionally bind to the original tab, HTTPS origin and expiring candidate ID. UI strings use textContent rather than interpolated vault HTML. Website messages cannot unlock, export, fill or replace a session. Similar-origin filling is blocked without an override, and visibility/navigation are rechecked before explicit filling. Capturing a submission cannot prove login success; a separate user save decision is required. Parent websites can remove or reposition an embedded prompt, so its placement is not a trusted browser security indicator. Users must verify the displayed original origin and account before saving. Persistent identity and vault contents are encrypted; offline data already cached on a revoked device cannot be remotely erased. Online authorization failure clears volatile access and blocks further sync. No claim is made to prevent malware or another privileged extension from reading an already-unlocked browser process.

Last updated: 2026-10-03

> Android mitigations in this document are required controls. Unless explicitly listed as verified, they must not be read as completed implementation.

## In Scope

- Malicious websites attempting to trick autofill.
- Sync server or database compromise.
- Network interception or replay.
- Browser extension permission abuse.
- Device theft while vault is locked.
- Accidental exposure of imported CSV files.
- Similar-domain phishing.
- Recovery code compromise.
- Device trust compromise.
- Extension permission escalation.
- Malicious Android Autofill/Credential Provider requests, package impersonation, signing-certificate changes, backup leakage, screenshots, clipboard history, process death, and Keystore invalidation.

## Mitigations

### Server and Storage

- Zero-knowledge storage: only encrypted envelopes are synced. The server stores ciphertext only.
- Item-level sync encrypts each item independently with a per-item key.
- AEAD with associated data: tampering fails during decryption.
- Revision-based sync: stale writes become conflicts.
- The Worker API uses D1 (SQLite) for all persistent storage.

### Autofill and Phishing

- User-confirmed fill: credentials are not inserted on page load.
- Exact HTTPS origin matching prevents fill on mismatched domains.
- Similar-origin classification (exact, similar, suspicious) warns users about potential phishing.
- HTTPS-only content script matching for fill candidates.
- Hidden, invisible, and cross-origin fields are excluded.
- Field visibility re-check before fill guards against DOM mutations after detection.
- Cross-origin iframe fills are blocked.

### Import

- CSV import is client-side only and must not write plaintext rows to disk.
- Plaintext never touches localStorage, API payloads, or logs.

### Recovery

- Recovery code is a 256-bit random value, never sent to the server.
- Recovery packet is encrypted with a key derived from the recovery code via Argon2id.
- Server stores only the encrypted recovery packet; it cannot decrypt without the code.

### Device Trust

- Each device has its own X25519 ECDH keypair.
- New devices require approval from an existing trusted device.
- Encrypted vault key is stored per device; the server cannot decrypt it.
- Revoking a device removes its encrypted vault key.

### Extension

- Extension declares `permissions: ["activeTab", "scripting", "storage"]` and `host_permissions: ["https://*/*"]` in `manifest.json`. The `host_permissions` grant is required for the content script to run on all HTTPS pages, but it is broader than a per-site approach. Chrome's `activeTab` permission limits API access until the user interacts with the extension.
- Credentials cached in session storage only while Web Vault is unlocked.
- Locking Web Vault clears extension session cache.

### Android

A historical 2026-07-16 snapshot produced remote evidence for native OPAQUE interoperability, Room v2 schema/migration and API 33–36 native security tests. Current and future automated Android validation runs only on API 36, while `minSdk 26` remains an install-compatibility declaration. Remaining gaps include the personal-release browser allowlist and real system-fill business validation, plus Recovery v2 trust rebuilding across total device loss.

- Match native apps by package plus signing-certificate SHA-256 and Web forms by normalized HTTPS origin.
- Keep keys and OPAQUE state behind Kotlin/Rust boundaries; JS receives only an expiring session handle.
- Store ciphertext only in Room; exclude database, wrapped keys, sessions, caches, and logs from Android backup.
- Lock on background/timeout/device lock; use `FLAG_SECURE`, sensitive clipboard metadata, and fail closed on Keystore invalidation.
- Autofill and Credential Provider use native `VaultRepository` and remain secure when the RN process is absent.

## Threats

### Phishing

**Threat:** Malicious sites mimic legitimate domains to trick autofill into revealing credentials.

**Mitigations:**
- Exact origin matching: fill only on exact HTTPS origin match.
- Similar-origin warnings: domains that look alike (e.g., `examp1e.com` vs `example.com`) are flagged as suspicious.
- No automatic fill: user must explicitly confirm each fill.
- Origin displayed in popup before fill.

### Recovery Code Compromise

**Threat:** Attacker obtains a user's recovery code and uses it to decrypt the vault key.

**Mitigations:**
- Recovery code is never sent to the server; it exists only on the user's device or written down offline.
- Recovery packet requires the code to derive the decryption key via Argon2id.
- Users are instructed to store the code offline (paper, safe).
- If a code is suspected compromised, the user can generate a new one, which invalidates the old packet.

### Device Trust Compromise

**Threat:** An attacker registers a rogue device or compromises an existing trusted device.

**Mitigations:**
- New device registration requires explicit approval from an existing trusted device.
- Each device has a unique X25519 keypair; compromising one device does not expose others.
- Device revocation removes the encrypted vault key from the server.
- Approval flow is user-initiated, not automatic.

### Extension Permission Escalation

**Threat:** A compromised or malicious extension update requests broader permissions to access credentials on all sites.

**Mitigations:**
- Extension declares minimal permissions in `manifest.json`.
- Permission changes are reviewed against `docs/autofill.md`.
- Content script runs only on matched origins.
- Extension does not store vault keys in persistent storage.

### Existing Threats

- Network interception or replay: mitigated by HTTPS, HSTS, and AEAD.
- Server/database compromise: mitigated by zero-knowledge storage (server only has ciphertext).
- Device theft while locked: vault is encrypted at rest; master password is required to unlock.
- CSV exposure: import is client-side only; plaintext never persisted.

### Cloudflare Deployment Threats

When deploying to Cloudflare Workers, D1, and R2, the following additional threats are in scope.

**Threat: Cloudflare account compromise.** An attacker who gains access to the Cloudflare account can read D1 data, access R2 objects, view Worker secrets, and deploy malicious Worker code.

**Mitigations:**
- Enable 2FA on the Cloudflare account.
- Use Cloudflare API tokens with minimal permissions for CI/CD pipelines.
- Restrict `wrangler login` access to trusted developers.
- Audit Cloudflare account access logs periodically.
- The zero-knowledge model limits the damage: the attacker sees only ciphertext envelopes, not plaintext vault contents.

**Threat: D1 access control.** Cloudflare dashboard users with D1 access can query the database directly and read all stored rows.

**Mitigations:**
- Limit Cloudflare dashboard access to essential team members.
- All vault item payloads and recovery packets are encrypted at the application level before storage.
- D1 data at rest encryption (Cloudflare-managed) adds a second layer.

**Threat: R2 bucket permissions.** If the R2 bucket is misconfigured with public access, encrypted export bundles could be accessible to unauthorized parties.

**Mitigations:**
- R2 buckets are private by default. Do not enable public access.
- Use signed URLs with short expiry for export downloads.
- Export bundles are encrypted at the application level before upload.
- Audit bucket settings after initial setup and after any infrastructure changes.

**Threat: Worker environment variable exposure.** Variables set in `wrangler.toml` `[vars]` are visible in the Cloudflare dashboard and in the committed repository.

**Mitigations:**
- Only non-secret values go in `[vars]` (e.g., `ENVIRONMENT`, `CORS_ORIGIN`).
- All secrets use `wrangler secret put` (encrypted at rest, not visible in dashboard).
- Review `wrangler.toml` before every commit to ensure no secrets are included.

## Explicit Non-Goals

- Protecting an unlocked vault on a fully compromised endpoint.
- Defending against malicious dependencies without dependency review and lockfile auditing.
- Chain-based custody of secrets. Blockchain is not part of the core security model.

## Open Risks

- OPAQUE is implemented with a TypeScript package; this should be reviewed before production release.
- New Web Vaults use generated Rust `crypto-core` WASM. Legacy WebCrypto vaults are not automatically migrated; an explicit rollback-safe Web migration is an Android production prerequisite because Android rejects the legacy format.
- API persistence uses D1 (SQLite) for all storage.
- Extension integrates with Web Vault unlock state through the session bridge, but `NEXT_PUBLIC_EXTENSION_ID` is still manually configured from the unpacked Chrome/Edge extension id.
- Browser extension now has an MVP picker/fill path, but browser-specific autofill restrictions still require manual compatibility testing in Chrome/Edge.
- Android implementation is in progress but not production-ready; code presence must not be confused with remote APK/API-matrix evidence. iOS remains out of scope and the desktop client is tracked separately.
- Recovery v2 now binds a fresh approved device, new OPAQUE record, new recovery material and old recovery authorization in one atomic epoch rotation. Until its remote replay/expiry/crash and total-device-loss E2E pass, this remains an unverified mitigation rather than a supported production promise.
- Rust Web vaults use cursor-based item sync, explicit conflict resolution and trusted-device key distribution. Joining browsers use device-bound HttpOnly cookies; pending/revoked devices cannot sync. Legacy unbound cookies remain compatible with existing Web accounts. Native acceptance still requires campus-server and physical-device checks.
