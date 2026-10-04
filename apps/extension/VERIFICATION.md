# Extension 0.2.2 verification

- 0.2.2 icons: Firefox toolbar/manager and popup favicon use the bundled SVG pixel key; Chromium has matching PNG sizes. Mozilla strict lint reports 0 errors/warnings, the icon files are present in the XPI, and both real Firefox regression tests pass. The isolated Web release builds with automatic SVG, ICO and Apple icon metadata.

- Firefox toolbar popup regression: the previous `max-width: 100vw` capped the auto-sized viewport at 36px. The popup now keeps its 360px body width; the embedded save prompt retains its viewport constraint. `e2e/firefox-popup.spec.ts` measures the actual toolbar popup rather than a tab.
- 0.2.1 checks: both real Firefox tests pass (toolbar sizing and independent save/fill/sync), extension typecheck and 57 unit tests pass, Mozilla lint reports 0 errors/warnings, and XPI archive integrity passes. Root typecheck currently stops on unrelated Desktop type errors. Root tests under the default Node runtime encounter a pre-existing SQLite ABI mismatch; Worker tests must use the installed Node 20 runtime.

Date: 2026-10-03

## Current evidence

- Firefox XPI packaging: web-ext 10.6.0 validation reports 0 errors, 0 warnings; ZIP integrity passes. Mozilla unlisted signing still requires AMO credentials; the unsigned XPI is not a permanent-install signature claim.
- Signing build requires Firefox 142+ for data-collection permission metadata. The bundled OPAQUE 1.1.0 global-object Function-constructor fallback is replaced in-memory during bundling by a fail-closed exception, matching the existing extension CSP; its cryptography and globalThis lookup are unchanged. Dependency files are not edited.

- Extension typecheck and 57 unit tests pass: strict message sender boundaries, rejected external publishing, exact-origin matching, field visibility/native setter, focus-triggered mutations, page-controlled selector rejection, explicit injection for an existing page, candidate expiry and exclusions, password rejection sampling, hostile UI strings, real WASM local identity/vault encryption, wrong-password/tamper rejection and offline lock/unlock persistence.
- Web typecheck, production static build and 192 unit tests pass, including the shared sync engine's two-client edits, deletions, exact retry after response loss and explicit conflicts.
- Worker typecheck and 208 tests pass; extension login uses bearer transport, pending-device restrictions and revocation checks. SHA-256 fingerprints are derived from the actual recipient public key for approval display, including legacy-route registrations.
- Real Chrome and Edge journeys pass independent device approval, plugin→Web save, Web→plugin password update, saved credential fill, password update prompt, wrong-login suppression and independent unlock with the Web page closed.
- Real Firefox passes independent approval, generator, isolated page save, plugin→Web and Web→plugin synchronization, exact-origin fill and absence of plaintext site passwords in persistent extension storage. Firefox uses a temporary profile and unsigned temporary add-on.
- Android/native acceptance remains pending the required campus-server connection. Browser evidence is not a claim of native Android verification.

## Runnable checks

From the repository root:

~~~sh
pnpm --filter @zero-vault/extension typecheck
pnpm --filter @zero-vault/extension test
pnpm --filter @zero-vault/web test
pnpm --filter @zero-vault/worker-api test
pnpm --filter @zero-vault/extension test:e2e
~~~

The default E2E project uses the installed Google Chrome. Set ZERO_VAULT_EDGE_BINARY to an actual Edge binary and ZERO_VAULT_GECKODRIVER to an official geckodriver to add those browser projects; ZERO_VAULT_FIREFOX_BINARY can override Firefox's location. Test fixtures use synthetic values and a local Worker/Web Vault, never production account data. Test builds are separate from release builds.

## Installation acceptance

Follow [INSTALL.md](INSTALL.md). Confirm:

1. Generator works while locked; copying and filling require separate actions.
2. Initial device remains pending until approved in Web/mobile; verify the full fingerprint.
3. An exact HTTPS site saves only after a choice; same credentials do not duplicate, changed passwords require explicit update.
4. A disappeared SPA form or same-origin navigation offers a prompt; a failed visible form does not. A different origin receives no old-site page prompt.
5. Locked prompts open an extension page to unlock; no master password input appears inside a website frame.
6. Multiple records require a selection. Similar/suspicious origins, HTTP, hidden/readonly/disabled fields and cross-origin frames remain blocked.
7. Offline saves remain encrypted locally and retry after reconnection. Conflicts remain visible until selected resolution.
8. Lock, five-minute inactivity and browser restart clear volatile vault access; candidates also expire and clear on tab close.
9. Cloud-session expiry requires account reauthentication; a revoked device receives no further cloud data.
10. Firefox temporary installation disappears at restart; long-term distribution requires Mozilla signing.

## Production package review

Permissions: activeTab, scripting, storage, alarms, HTTPS host access. No cookie, network interception or clipboard read permission. Only the isolated save prompt and its UI assets are web-accessible. Production manifests have no externally_connectable website allowlist or localhost API override. WASM is bundled, external JS and unsafe-eval are not used. Packaging refuses test manifests and produces SHA256SUMS beside the two ZIPs.
