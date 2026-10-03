# Security Model

## Independent extension devices (2026-10-03)

The browser extension derives a local protection key through the same Rust/WASM Argon2id core as Web. It encrypts device private key, device credential and bearer/CSRF session material under that local key with the `zero-vault:extension-identity:v1` AAD; the shared vault key remains wrapped using the existing local-key-wrap AAD. Master/account passwords are never persisted. Only an approved device can fetch its recipient-bound vault key packet. Volatile unlock access lives in restricted storage.session, expires after five minutes of inactivity and clears at restart. The extension accepts privileged operations only from its own top-level popup; isolated save prompts are limited to a tab/origin-bound candidate. External Web plaintext publishing is disabled. Website-origin permissions do not grant pages access to the encrypted vault or volatile keys.

Last updated: 2026-10-03

## Shared keys in Web

An approved joining browser receives the account vault key through an X25519 device packet. Argon2id derives its local password protection key, and XChaCha20-Poly1305 (`zero-vault:local-key-wrap:v1` AAD) wraps the shared key. Only the wrapped value and encrypted snapshot are persisted. Changing the browser-local password rewraps the same key without rekeying other devices. Existing password-derived Web vaults remain readable and can share their current key with Android.

New joining browsers use device-bound HttpOnly cookies with pending/revocation restrictions. Pages forwards only `/api/*` to the fixed Worker origin and disables API response caching. A local vault is pinned to its account before sync to prevent another account's revisions or mutation queue from being reused.

> Android key custody and Recovery v2 trust-rebuild code now exist in the working tree, but current-snapshot remote APK/instrumented verification is pending. Native OPAQUE is intentionally disabled until cross-implementation verification, and the generated Room v2 schema JSON is still missing. See `docs/android-dev/overview.md`.

## Goals

- Protect vault contents if the sync server or database is compromised.
- Prevent malicious websites from silently extracting credentials.
- Keep browser-imported plaintext credentials in memory only.
- Make account recovery possible without giving the server decryption power.
- Support multiple devices without exposing the vault key to the server.

## Key Hierarchy

- Master password: user secret, never sent to server.
- Master key: new local vaults derive this locally with Rust `crypto-core` WASM using Argon2id. Legacy WebCrypto vaults derive their local vault wrapping key with PBKDF2-SHA256 and remain compatible.
- Vault key: random symmetric key wrapped by a master-key-derived key.
- Item key: random symmetric key per item, derived from the vault key. Used by item-level sync.
- Item payload: each item payload is encrypted with AEAD using its item key.
- Recovery packet: encrypted locally and unlockable only with recovery code or trusted-device authorization.

## Dual Runtime Model

The project supports two crypto runtimes:

**`crypto-core-wasm` (default for new vaults):**
- KDF: Argon2id v1.3.
- Cipher: XChaCha20-Poly1305 with authenticated associated data.
- Source: Rust `crates/crypto-core` compiled to WASM via `wasm-pack`.

**`webcrypto-mvp` (legacy, still supported):**
- KDF: PBKDF2-SHA256 with 310,000 iterations.
- Cipher: AES-256-GCM with random 96-bit nonce and authenticated associated data.
- Source: Web Crypto API.

New vaults always use `crypto-core-wasm`. Legacy `webcrypto-mvp` vaults can be unlocked and are re-sealed in their original format. There is no automatic migration. Android production now makes migration a required Web-side flow; it must be explicit, user-confirmed, and covered by rollback and tamper tests.

Android does not implement the legacy `webcrypto-mvp` AES/PBKDF2 runtime. A legacy vault must be explicitly migrated in Web, including item ciphertext and recovery-packet rotation to the Rust format, before Android accepts it.

## Android Key Custody

The Android target uses the same Rust crypto formats through UniFFI. Kotlin `VaultRepository` owns native sessions, Room, Keystore and system-service access in the current implementation, pending remote verification. JavaScript must never receive vault keys, device private keys, OPAQUE state or the Keystore wrapping key. Room stores only ciphertext and sync metadata; biometric authentication authorizes a Keystore operation and is not a replacement for the master password or recovery code.

## Local Vault Runtime

The Rust `crypto-core` exposes WASM bindings for Argon2id and XChaCha20-Poly1305:

- Storage: ciphertext envelope only in `localStorage`.
- Plaintext scope: React memory while the vault is unlocked; locking clears the unlocked state and extension session cache.

## Item-Level Encryption

Item-level sync (Phase 4) encrypts each vault item independently:

1. The vault key is a random symmetric key generated at vault creation.
2. Each item gets a random item key derived from the vault key.
3. Each item payload (credentials, notes, metadata) is encrypted with AEAD using its item key.
4. The encrypted item is stored as a ciphertext envelope with its own revision number.
5. The server stores only the ciphertext envelope, revision, and item ID.

This design allows per-item sync, per-item conflict detection, and per-item recovery without exposing other items.

## Recovery Code Crypto

Recovery codes allow vault access without the master password:

1. A 256-bit random recovery code is generated and displayed to the user as a base64url string.
2. The code is fed through a KDF to derive a recovery key.
3. The recovery key encrypts the vault key, producing a recovery packet.
4. The recovery packet is stored server-side (encrypted); the recovery code is never sent to the server.
5. To recover: the user enters the code, the client derives the recovery key, decrypts the recovery packet, and unlocks the vault.

The KDF and cipher match the dual-runtime model: `crypto-core-wasm` uses Argon2id + XChaCha20-Poly1305; the current Web Vault recovery path uses PBKDF2-SHA256 + AES-256-GCM. See `docs/recovery.md` for details.

The recovery code must be stored offline (written on paper, stored in a safe). The server cannot decrypt the recovery packet without the code.

Decrypting a recovery packet alone is not server authentication. Android Recovery v2 additionally signs a one-time, field-bound transcript with a key derived inside the encrypted packet; the Worker atomically rotates the account epoch and recovery material, revokes old trust, and installs one approved replacement device before the client performs normal OPAQUE login. This source implementation remains fail closed and is not a production guarantee until the current remote interoperability, D1, replay/expiry, crash-continuation and total-device-loss E2E gates pass. See `docs/recovery.md`.

## Device Trust Crypto

Device trust allows multiple devices to access the same vault:

1. Each device generates an X25519 ECDH keypair on registration.
2. The device public key is registered with the server.
3. When a new device requests access, an existing trusted device approves the request.
4. The approving device encrypts the vault key with the new device's public key via ECDH.
5. The encrypted vault key is stored server-side per device.
6. The server cannot decrypt the encrypted vault key without the device private key.

Revoking a device removes its encrypted vault key from the server, preventing future decryption on that device.

## Authentication

The API uses OPAQUE registration and login flows. The server stores the OPAQUE registration record and never receives the master password. Web login returns an opaque random session token as an `HttpOnly` cookie. Android's separate mobile finish route returns the same class of random token as a bearer credential to native secure storage. Only the token SHA-256 is stored server-side.

Non-GET authenticated write requests require a CSRF token in `x-zero-vault-csrf`. The token is returned in the login response and bound to the server-side session record.

## Storage

The server may store:

- User id and email.
- OPAQUE registration record or equivalent PAKE verifier material.
- Public key bundle.
- Encrypted recovery packet.
- Encrypted vault item envelopes (whole-envelope or per-item).
- Per-device encrypted vault keys (device trust).
- Revision and deletion metadata.

Web session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Local HTTP development disables `Secure` so localhost testing works. Android bearer tokens must never enter URLs or logs and must use platform secure storage at rest; current implementation and invalidation behavior still require remote instrumented evidence.

The server must not store:

- Master password.
- Derived keys.
- Plaintext passwords, domains, usernames, notes, or import CSV rows.
- Recovery codes.

## Sync

### Whole-Envelope Sync (Legacy, Still Supported)

The original sync path stores the complete encrypted local vault as one encrypted `VaultItemCiphertext` envelope. This keeps the server zero-knowledge and enables device restore. It remains supported for backward compatibility.

### Item-Level Sync (New Default)

Item-level sync replaces whole-envelope sync as the default:

1. Client creates an `ItemLevelSyncPlan` with per-item upserts and deletes.
2. Each upsert includes `baseItemRevision` for conflict detection.
3. Server returns `ItemLevelSyncResponse` with applied IDs and conflicts.
4. Client resolves conflicts via UI (keep local, accept remote, create copy, skip).
5. Pull returns all items as ciphertext plus `serverRevision`.

The server never sees plaintext during either sync mode.

## Extension Boundary

The browser extension receives an unlocked-session credential index from Web Vault through extension messaging after Web Vault unlocks or the unlocked vault changes. It must store this only in `chrome.storage.session`, never persistent extension storage. Locking Web Vault clears the extension session cache.

During local development, Web Vault can only publish to the extension when `NEXT_PUBLIC_EXTENSION_ID` is set to the unpacked Chrome/Edge extension id. This manual configuration is a current product limitation, not a security guarantee.

## Transport

Production traffic requires HTTPS, HSTS, secure cookies or bearer tokens with strict expiry. Zero Vault currently requires the session-bound CSRF header for authenticated writes from both Web and Android as defense in depth. TLS does not replace end-to-end encryption.

## Cloudflare-Specific Security Notes

When deploying to Cloudflare Workers with D1 and R2, the following considerations apply in addition to the general security model above.

### D1 Data at Rest

Cloudflare D1 databases are encrypted at rest using Cloudflare-managed keys. This is transparent to the application. The application-level encryption (item-level AEAD) provides an additional layer: even if D1 storage were compromised, the attacker would only see ciphertext envelopes.

### R2 Encryption at Rest

Cloudflare R2 objects are encrypted at rest using Cloudflare-managed keys. As with D1, the application encrypts export bundles before writing to R2, so the stored data is double-encrypted.

### Worker Isolation Model

Each Cloudflare Worker request runs in an isolated V8 isolate. There is no shared mutable state between requests. In-memory rate limiting or caching resets on every new isolate (cold start). Use D1-backed state for anything that must persist across requests.

### Session Cookie Domain

When the Worker API and Web Vault are on different subdomains (e.g., `api.example.com` and `vault.example.com`), the session cookie domain must be configured explicitly. Set the cookie domain to the shared parent domain (e.g., `.example.com`) with `SameSite=Lax` to allow cross-subdomain requests. If using `*.workers.dev` domains, cross-subdomain cookies are not possible; deploy both on the same custom domain or use the same subdomain.

### Secrets in Workers

Wrangler secrets are encrypted at rest and injected into the Worker runtime at execution time. They are not visible in the Cloudflare dashboard or in logs. Environment variables in `[vars]` are visible in the dashboard and in `wrangler.toml`; never put secrets in `[vars]`.
