# Deployment

Last updated: 2026-06-04

## Production Environment Checklist

Complete every item before deploying to production.

### HTTPS

- [ ] TLS terminates at the reverse proxy or load balancer (e.g. Nginx, Caddy, Cloudflare).
- [ ] HTTP requests redirect to HTTPS (301).
- [ ] HSTS header is set: `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
- [ ] `SECURE_COOKIES=true` is set in the environment (see below).

### Secure Cookie Settings

- [ ] `SECURE_COOKIES=true` so session cookies carry the `Secure` flag.
- [ ] Cookies use `SameSite=Lax` or `SameSite=Strict` (the API sets this automatically when `SECURE_COOKIES` is enabled).
- [ ] Cookies use `HttpOnly` (the API sets this automatically).

### CORS Allowlist

- [ ] `CORS_ORIGINS` is set to the exact origins that may call the API (comma-separated).
- [ ] No wildcard (`*`) origins in production.
- [ ] The browser extension origin is included if the extension calls the API directly.

### OPAQUE Server Setup Keys

- [ ] `OPAQUE_SERVER_SETUP` is set to a stable, backed-up value.
- [ ] If left empty, the server auto-generates a key on first startup. This key must never change after users register. Back it up immediately.
- [ ] Store the key in a secrets manager (not in `.env` files committed to the repo).

### MAINTENANCE_TOKEN

- [ ] `MAINTENANCE_TOKEN` is set to a strong, random string (e.g. `openssl rand -hex 32`).
- [ ] The token is stored in a secrets manager and injected at deploy time.
- [ ] Maintenance endpoints are firewalled or restricted to trusted IPs where possible.

### All Environment Variables

Every variable from `.env.example` must be configured. See the [Environment Variables](#environment-variables) table below for the full list.

### Secrets Management

- NEVER commit real secrets (passwords, tokens, private keys) to the repository.
- Use `.env` files locally (gitignored) and a secrets manager in production (AWS Secrets Manager, Vault, Doppler, etc.).
- Rotate `MAINTENANCE_TOKEN` periodically.
- If a secret is accidentally committed, rotate it immediately and scrub the git history.

---

## Deployment Options

Zero Vault deploys on **Cloudflare Workers + D1 + R2** -- serverless, no infrastructure to manage. See [cloudflare-deployment.md](./cloudflare-deployment.md) for the full guide.

## Environment Variables

### Required for Production (Worker API)

The Worker API uses Wrangler secrets for sensitive configuration. See [cloudflare-deployment.md](./cloudflare-deployment.md) for setup.

### Web App (Client-Side)

| Variable | Description | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | API URL for client-side requests | `https://api.example.com` |
| `NEXT_PUBLIC_EXTENSION_ID` | Chrome extension ID for session bridge | (manual) |

## API Security Hardening

The Worker API handles CSRF, rate limiting, and body size limits internally. Configure CORS and secrets via Wrangler (see [cloudflare-deployment.md](./cloudflare-deployment.md)).

## Extension Publishing

### Chrome Web Store

1. Build the extension: `npx pnpm dev:extension`
2. Zip the `apps/extension/dist` directory.
3. Upload to the Chrome Web Store Developer Dashboard.
4. Set the extension ID in production `NEXT_PUBLIC_EXTENSION_ID`.

### Edge Add-ons

1. Build the extension: `npx pnpm dev:extension`
2. Zip the `apps/extension/dist` directory.
3. Upload to the Microsoft Edge Add-ons Developer Dashboard.
4. Set the extension ID in production `NEXT_PUBLIC_EXTENSION_ID`.

### Post-Publishing

- Update `CORS_ORIGINS` if the extension origin changes.
- Update `NEXT_PUBLIC_EXTENSION_ID` in the web app environment.
- Test the session bridge between Web Vault and the published extension.

## Cloudflare Workers Deployment

For serverless deployment on Cloudflare Workers with D1 and R2, see the dedicated guide:

**[Cloudflare Deployment Guide](./cloudflare-deployment.md)**

This covers D1 database setup, R2 bucket configuration, Wrangler secrets, local development with `wrangler dev`, preview and production deployments, custom domains, and monitoring.
