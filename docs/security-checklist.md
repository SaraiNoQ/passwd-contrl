# Security Checklist

Last updated: 2026-06-04

Use this checklist before every production release. All items must pass.

## 1. Dependency Audit

### npm / pnpm

- [ ] `npx pnpm audit` reports zero critical or high vulnerabilities.
- [ ] `pnpm-lock.yaml` is committed and matches `package.json` ranges.
- [ ] No dependencies with known supply-chain compromises (check against GitHub Advisory Database).
- [ ] Unused dependencies removed from all workspace `package.json` files.
- [ ] Dev-only dependencies are not bundled into production builds.

### Cargo (Rust)

- [ ] `cargo audit --file crates/crypto-core/Cargo.toml` reports zero vulnerabilities.
- [ ] `Cargo.lock` is committed.
- [ ] No `unsafe` blocks without justification and review comment.
- [ ] WASM output size is within budget (check with `ls -lh packages/crypto-core-wasm/pkg/*.wasm`).

### OPAQUE Dependency

- [ ] `@serenity-kit/opaque` version is pinned and reviewed (see threat-model.md open risks).
- [ ] Upstream changelog reviewed for security-relevant changes before any version bump.

## 2. OWASP Top 10 (2021) Checklist

| # | Category | Status | Notes |
| --- | --- | --- | --- |
| A01 | Broken Access Control | [ ] | Session cookies are HttpOnly, SameSite=Lax, Secure in production. CSRF token required on non-GET writes. Device approval is user-initiated. |
| A02 | Cryptographic Failures | [ ] | Argon2id + XChaCha20-Poly1305 via Rust WASM (default). PBKDF2 + AES-256-GCM (legacy). No plaintext in storage or transit. |
| A03 | Injection | [ ] | D1 uses prepared statements. No raw SQL in API routes. |
| A04 | Insecure Design | [ ] | Zero-knowledge model: server never sees plaintext. Item-level encryption. Confirmed fill. |
| A05 | Security Misconfiguration | [ ] | No wildcard CORS in production. HSTS enabled. Secure cookies enforced. No secrets in `[vars]` or committed files. |
| A06 | Vulnerable and Outdated Components | [ ] | Covered by dependency audit section above. |
| A07 | Identification and Authentication Failures | [ ] | OPAQUE PAKE (no plaintext password to server). Session hash stored server-side. Rate limiting on auth endpoints. |
| A08 | Software and Data Integrity Failures | [ ] | AEAD ensures tamper detection. Revision-based sync prevents stale overwrites. Lockfile committed. |
| A09 | Security Logging and Monitoring Failures | [ ] | Security leakage regression tests exist. Wrangler tail for Cloudflare. Production logging level configurable. |
| A10 | Server-Side Request Forgery | [ ] | API does not make outbound HTTP requests based on user input. |

## 3. Cryptographic Review

- [ ] Argon2id parameters are documented and appropriate (memory cost, time cost, parallelism).
- [ ] XChaCha20-Poly1305 nonces are random and never reused (24-byte random nonce per encryption).
- [ ] HKDF per-item key derivation uses distinct info strings per item type.
- [ ] Vault key is random 256-bit, generated client-side at vault creation.
- [ ] Recovery code is 256-bit random, base64url encoded, never sent to server.
- [ ] Recovery packet KDF matches the dual-runtime model (Argon2id for crypto-core-wasm, PBKDF2 for webcrypto-mvp).
- [ ] X25519 ECDH keypairs are generated per device; private key stored in IndexedDB, never in localStorage.
- [ ] Legacy webcrypto-mvp uses PBKDF2-SHA256 with 310,000+ iterations.
- [ ] No cryptographic material in logs, error messages, or test fixtures.
- [ ] Random number generation uses `crypto.getRandomValues()` (browser) or `OsRng` (Rust).

## 4. Session Management

- [ ] Session tokens are opaque random values (not sequential or predictable).
- [ ] Only the SHA-256 hash of the session token is stored server-side.
- [ ] Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (production).
- [ ] Session expiry is enforced server-side; expired sessions are rejected.
- [ ] `cleanupExpiredSessions` runs on a schedule or is called periodically.
- [ ] Locking the vault clears the extension session cache (`chrome.storage.session`).
- [ ] Session invalidation on logout removes the server-side session record.
- [ ] No session token in URL parameters or localStorage.
- [ ] OPAQUE server setup key is stable after first user registers (rotation requires migration plan).

## 5. CSRF Protection

- [ ] All non-GET authenticated write endpoints require `x-zero-vault-csrf` header.
- [ ] CSRF token is returned in the login response.
- [ ] CSRF token is bound to the server-side session record.
- [ ] GET endpoints do not mutate state.
- [ ] `SameSite=Lax` cookie attribute provides additional CSRF defense.
- [ ] CSRF token validation is tested in `apps/worker-api/src/routes/auth.test.ts`.
- [ ] Security leakage tests verify missing/invalid CSRF is rejected.

## 6. Rate Limiting

- [ ] Registration endpoint has rate limiting (prevent spam account creation).
- [ ] Login endpoint has rate limiting (prevent brute force).
- [ ] Sync endpoints have rate limiting (prevent abuse).
- [ ] Rate limits are applied per IP or per session (not globally).
- [ ] Rate limit responses use HTTP 429 with appropriate `Retry-After` header.
- [ ] Rate limiting works in the Worker API.
- [ ] Worker API: rate limiting resets on cold start (V8 isolate model); consider D1-backed counters for production.

## 7. Extension Security

- [ ] Minimal permissions in `manifest.json`: `activeTab`, `scripting`, `storage`.
- [ ] `host_permissions` is `["https://*/*"]` (required for content script, documented as broader than per-site).
- [ ] No broad host access beyond HTTPS.
- [ ] Content script does not exfiltrate data to third parties.
- [ ] Extension does not store vault keys in persistent storage.
- [ ] Session bridge clears on vault lock.
- [ ] `NEXT_PUBLIC_EXTENSION_ID` is set to the correct published extension ID in production.

## 8. Infrastructure

- [ ] HTTPS terminates at reverse proxy or load balancer.
- [ ] HSTS header: `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
- [ ] Cloudflare: 2FA enabled on account. API tokens have minimal permissions.
- [ ] Cloudflare: R2 buckets are private. No public access.
- [ ] Cloudflare: Secrets use `wrangler secret put`, not `[vars]`.

## References

- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
- [Security Model](./security-model.md)
- [Threat Model](./threat-model.md)
- [Deployment](./deployment.md)
- [Cloudflare Deployment](./cloudflare-deployment.md)
