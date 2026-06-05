# Release Process

Last updated: 2026-06-04

## Version Numbering

Zero Vault uses [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

| Component | Example | When to bump |
| --- | --- | --- |
| MAJOR | 1.0.0 | Breaking changes to the sync protocol, encryption format, or API contract. |
| MINOR | 0.2.0 | New features (e.g., item-level sync, device trust) that are backward-compatible. |
| PATCH | 0.1.1 | Bug fixes, documentation updates, dependency patches. |

**Pre-1.0 convention:** While the project is pre-1.0, MINOR bumps indicate meaningful feature additions and PATCH bumps indicate fixes. The API and sync protocol are not yet considered stable.

### Where the Version Lives

- `package.json` (root): `"version": "0.1.0"`
- Git tags: `v0.1.0`, `v0.2.0`, etc.
- Worker API does not have a separate version; it shares the monorepo version.

## Release Checklist

Complete every item before tagging a release.

### 1. Pre-Release Verification

- [ ] All tests pass:
  ```sh
  npx pnpm typecheck
  npx pnpm test
  npx pnpm test:e2e
  npx pnpm test:rust
  ```
- [ ] WASM builds cleanly:
  ```sh
  npx pnpm wasm:build
  ```
- [ ] Dependency audit passes:
  ```sh
  npx pnpm audit
  cargo audit --file crates/crypto-core/Cargo.toml
  ```
- [ ] Security checklist completed: see [security-checklist.md](./security-checklist.md).
- [ ] Browser compatibility testing completed: see [browser-compatibility.md](./browser-compatibility.md).

### 2. Documentation

- [ ] `docs/roadmap.md` phase status is current.
- [ ] `docs/release-gate.md` reflects actual gate status.
- [ ] `docs/security-model.md` matches implementation.
- [ ] `docs/threat-model.md` open risks reviewed.
- [ ] All internal doc links are valid.
- [ ] CHANGELOG entry written (if maintained).

### 3. Database

- [ ] D1 migrations tested locally:
  ```sh
  cd apps/worker-api && npx wrangler d1 migrations apply zero-vault-db --local
  ```
- [ ] Migration is reversible or documented as irreversible.

### 4. Tag and Build

- [ ] Update version in root `package.json`.
- [ ] Commit version bump.
- [ ] Tag the release:
  ```sh
  git tag v0.1.0
  git push origin v0.1.0
  ```
- [ ] CI passes on the tagged commit.

## Deployment: Cloudflare Worker API

### Prerequisites

- Cloudflare account with Workers Paid plan.
- Wrangler CLI authenticated: `npx wrangler login`.
- D1 database created and `database_id` set in `wrangler.toml`.
- R2 bucket created and binding configured.
- Secrets set: `SESSION_SECRET`, `OPAQUE_SERVER_SETUP`, `MAINTENANCE_TOKEN`.

### Steps

1. **Apply D1 migrations:**
   ```sh
   cd apps/worker-api
   npx wrangler d1 migrations apply zero-vault-db
   ```

2. **Deploy the Worker:**
   ```sh
   cd apps/worker-api
   npx wrangler deploy
   ```

3. **Verify:**
   - [ ] Worker responds: `curl https://zero-vault-api.<subdomain>.workers.dev/health`.
   - [ ] Registration works.
   - [ ] Login works.
   - [ ] Item-level sync works.
   - [ ] Secrets are set: `npx wrangler secret list`.

4. **Deploy the Web Vault:**
   - Set `NEXT_PUBLIC_API_URL` to the Worker URL.
   - Deploy to Vercel or equivalent.

5. **Smoke test the full flow:**
   - Same as Worker API steps above.

### Post-Deployment Monitoring

- [ ] `npx wrangler tail` shows no errors.
- [ ] Cloudflare dashboard: Worker error rate is normal.
- [ ] D1 dashboard: query counts and storage are within limits.
- [ ] R2 dashboard: storage usage is within limits.

## Rollback

### Cloudflare Worker

1. List recent deployments:
   ```sh
   npx wrangler deployments list
   ```
2. Roll back to a previous deployment:
   ```sh
   npx wrangler rollback <deployment-id>
   ```
3. If a D1 migration was applied, apply the reverse migration (if available) or restore from D1 backup.
4. Verify the Worker is serving the previous version.

## Extension Release

1. Build the extension:
   ```sh
   npx pnpm dev:extension
   ```
2. Zip `apps/extension/dist`.
3. Upload to Chrome Web Store Developer Dashboard and/or Edge Add-ons Developer Dashboard.
4. Wait for review and approval.
5. Update `NEXT_PUBLIC_EXTENSION_ID` in the Web Vault environment.
6. Test session bridge with the published extension.
