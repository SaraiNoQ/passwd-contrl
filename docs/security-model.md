# Security Model

Last updated: 2026-06-04

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

New vaults always use `crypto-core-wasm`. Legacy `webcrypto-mvp` vaults can be unlocked and are re-sealed in their original format. There is no automatic migration. If migration becomes a product requirement, it must be explicit, user-confirmed, and covered by rollback and tamper tests.

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

The API uses OPAQUE registration and login flows through `@serenity-kit/opaque`. The server stores the OPAQUE registration record and never receives the master password. Login success creates an opaque random session token stored as an `HttpOnly` cookie; only its SHA-256 hash is stored server-side.

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

Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Local HTTP development disables `Secure` so localhost testing works.

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

Production traffic requires HTTPS, HSTS, secure cookies or bearer tokens with strict expiry, and CSRF protection where cookies are used. TLS does not replace end-to-end encryption.

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
