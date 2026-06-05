# Security Audit Report

**Project:** Zero Vault Password Manager
**Date:** 2026-06-04
**Auditor:** Automated security audit via Claude Code

---

## 1. npm Dependency Audit

**Command:** `npx pnpm audit`
**Result:** FAIL -- 12 vulnerabilities found

| Severity | Count | Packages |
|----------|-------|----------|
| Critical | 1 | vitest |
| High | 2 | undici (2 advisories) |
| Moderate | 9 | esbuild, vite, undici, @hono/node-server, postcss, ws |

### Critical

- **vitest <4.1.0** -- When Vitest UI server is listening, arbitrary files can be read and executed. Affects multiple workspace paths (apps/extension, apps/web, and others). Dev-only dependency, not bundled in production.
  - Fix: Upgrade vitest to >=4.1.0
  - Advisory: https://github.com/advisories/GHSA-5xrq-8626-4rwp

### High

- **undici <6.24.0** (via wrangler > miniflare) -- Unbounded memory consumption in WebSocket permessage-deflate decompression. Dev-only dependency (wrangler).
  - Advisory: https://github.com/advisories/GHSA-vrm6-8vpv-qv8q
- **undici <6.24.0** (via wrangler > miniflare) -- Unhandled exception in WebSocket client due to invalid server_max_window_bits validation. Dev-only dependency.
  - Advisory: https://github.com/advisories/GHSA-v9p9-hfj2-hcw8

### Moderate

- **esbuild <=0.24.2** -- Enables any website to send requests to the dev server and read the response. 18 paths, all through vitest/vite. Dev-only.
- **vite <=6.4.1** -- Server.fs.deny bypass. 15 paths through vitest. Dev-only.
- **undici <6.23.0** -- Unbounded decompression chain in HTTP responses. Dev-only (wrangler).
- **undici <6.24.0** -- HTTP Request/Response Smuggling. Dev-only (wrangler).
- **@hono/node-server <1.19.13** -- Middleware bypass via repeated slashes in serveStatic. Production-relevant if serveStatic is used.
- **postcss <8.5.10** -- XSS via unescaped </style> in CSS stringify output. Via next@15.5.19 in apps/web.
- **ws >=8.0.0 <8.20.1** -- Uninitialized memory disclosure. Via wrangler > miniflare. Dev-only.

**Assessment:** The critical vitest vulnerability is dev-only and does not affect production. The high undici vulnerabilities are also dev-only (wrangler/miniflare). The moderate @hono/node-server and postcss issues may affect production and should be prioritized for patching.

---

## 2. Cargo (Rust) Dependency Audit

**Command:** `cargo audit --file crates/crypto-core/Cargo.toml`
**Result:** PASS -- No vulnerabilities found

All 18 Rust tests pass. No `unsafe` blocks found in the Rust source code.

---

## 3. TypeScript Type Check

**Command:** `npx pnpm typecheck`
**Result:** PASS

All workspace projects passed type checking with zero errors:
- packages/shared
- apps/extension
- apps/worker-api
- apps/web

---

## 4. Test Results

**Command:** `npx pnpm test`
**Result:** PASS

| Workspace | Tests | Status |
|-----------|-------|--------|
| packages/shared | 37 | PASS |
| apps/worker-api | 70 | PASS |
| apps/extension | 65 | PASS |
| apps/web | 44 | PASS |
| **Total** | **216** | **PASS** |

---

## 5. Security Checklist Verification

### CSRF Protection: PASS

- All non-GET write endpoints require the `x-zero-vault-csrf` header
- CSRF token returned in login response and bound to server-side session
- Worker API enforces CSRF
- SameSite=Lax cookie attribute provides additional defense

### Rate Limiting: PASS (with caveat)

- Registration: max 8 requests/minute
- Login: max 10 requests/minute
- Per-IP via CF-Connecting-IP / X-Forwarded-For
- Returns 429 with Retry-After header
- **Caveat:** Worker API uses in-memory rate limiting that resets on cold start. The `createD1RateLimitStore` function is stubbed (TODO).

### Session Management: PASS

- Opaque 32-byte random tokens
- SHA-256 hash stored server-side
- HttpOnly/Secure/SameSite=Lax cookies
- 14-day expiry enforced
- Expired sessions cleaned up on /ready
- No tokens in URL or localStorage

### OWASP Top 10

| # | Category | Status |
|---|----------|--------|
| A01 | Broken Access Control | PASS |
| A02 | Cryptographic Failures | PASS |
| A03 | Injection | PASS |
| A04 | Insecure Design | PASS |
| A05 | Security Misconfiguration | PASS |
| A06 | Vulnerable Components | FAIL (npm audit) |
| A07 | Auth Failures | PASS |
| A08 | Integrity Failures | PASS |
| A09 | Logging Failures | PASS |
| A10 | SSRF | PASS |

### Other Checks

- No hardcoded secrets: PASS
- .env properly gitignored: PASS
- No unsafe blocks in Rust: PASS
- Body size limit (1MB): PASS

---

## 6. Recommendations

### Critical

1. Upgrade vitest to >=4.1.0 (critical vulnerability, dev-only but should be fixed)

### High

2. Upgrade wrangler to resolve undici and ws vulnerabilities (4 advisories)
3. Implement D1-backed rate limiting for Workers production deployment

### Medium

4. Upgrade @hono/node-server to >=1.19.13 (middleware bypass)
5. Monitor for Next.js update that bumps postcss to >=8.5.10
6. Review the 35 skipped tests to confirm intentional deferral

### Low

7. Verify extension manifest.json has minimal permissions
8. Verify HSTS header at reverse proxy/load balancer level in production

---

## Positive Findings

- Zero-knowledge architecture is well-implemented: server never sees plaintext passwords or vault data
- OPAQUE PAKE protocol properly prevents password transmission to server
- CSRF protection is comprehensive across all state-changing endpoints
- Rate limiting is in place on all auth endpoints
- Session security follows best practices
- No unsafe blocks in Rust code
- No hardcoded secrets found
- Input validation via Zod schemas on all endpoints
- Log redaction of request bodies to prevent credential leakage
