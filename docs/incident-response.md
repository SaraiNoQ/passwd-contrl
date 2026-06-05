# Incident Response

Last updated: 2026-06-04

## Overview

This document defines procedures for responding to security incidents in Zero Vault. Incidents are classified by severity and type.

## Plaintext Exposure

If plaintext (passwords, usernames, domains, CSV data, recovery codes, or derived keys) is found in logs, storage, API payloads, or test fixtures:

### Immediate Actions

1. **Remove the exposure:** Delete or redact the plaintext from the affected location.
2. **Assess scope:** Determine what data was exposed, for how long, and who had access.
3. **Rotate secrets:** If recovery codes or derived keys were exposed, generate new ones.
4. **Notify affected users:** See User Notification below.

### Root Cause

- Audit how the plaintext entered the forbidden location.
- Add or fix the guard that allowed it (e.g., a logging statement that serializes sensitive fields).
- Add a test that asserts the absence of plaintext in the affected boundary.

## Crypto Vulnerability

If a vulnerability is discovered in the cryptographic implementation (key derivation, encryption, AEAD, OPAQUE, recovery, or device trust):

### Immediate Actions

1. **Assess severity:** Determine if the vulnerability is exploitable in practice (e.g., requires local access, network position, or specific conditions).
2. **If actively exploited:** Rotate all affected keys. For vault key compromise, users must re-encrypt their vaults.
3. **If not actively exploited:** Prepare a fix and schedule an emergency release.

### Remediation

1. Fix the vulnerability in the affected crate or package.
2. Add regression tests that verify the fix.
3. If the vulnerability affects stored ciphertext, plan a re-encryption migration:
   - Users unlock their vault with the old crypto.
   - Vault is re-encrypted with the fixed crypto.
   - Old ciphertext is replaced.
4. Update `docs/security-model.md` and `docs/threat-model.md`.

## Rollback Procedures

### API Rollback

1. Roll back the Worker deployment:
   ```sh
   cd apps/worker-api && npx wrangler rollback <deployment-id>
   ```
2. If a D1 migration was applied, apply the reverse migration or restore from D1 backup.
3. Verify that the Worker is serving correctly.

### Extension Rollback

1. Revert to the previous extension version in the Chrome Web Store / Edge Add-ons dashboard.
2. Users with auto-update will receive the rollback within hours.
3. For manual installs, distribute the previous version's zip.

### Web Vault Rollback

1. Deploy the previous known-good web app version.
2. Clear any cached assets (CDN, service worker).
3. Verify that the web app connects to the API correctly.

## User Notification

### When to Notify

- Plaintext exposure affecting user data.
- Crypto vulnerability that could expose vault contents.
- Unauthorized access to the server or database.
- Recovery code or device trust compromise.

### How to Notify

1. In-app banner on next login.
2. Email to registered address (if available).
3. If the vault key may be compromised, force a password change and recovery code rotation.

### What to Communicate

- What happened (without revealing exploit details).
- What data was affected.
- What actions the user should take (e.g., change password, regenerate recovery code).
- What Zero Vault has done to fix the issue.

## Post-Incident

1. Write a post-incident report covering timeline, root cause, impact, and remediation.
2. Update this document if new procedures are needed.
3. Add regression tests for the incident scenario.
4. Review and update `docs/threat-model.md` if the incident revealed a new threat.
