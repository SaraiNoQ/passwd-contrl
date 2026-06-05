# Phase 3 Browser Extension Plan

## Goal

Phase 3 turns the Web Vault into a usable browser autofill flow for Chrome and Edge MV3. The extension must detect HTTPS login forms, show matching unlocked credentials in the popup, and fill only after explicit user confirmation.

Mobile apps, Firefox support, silent autofill, automatic submit, and final item-level sync remain out of scope for Phase 3.

## Architecture

- `background` owns origin matching, session state, active-page form state, and message routing.
- `content-script` detects forms and fills selected visible fields only.
- `popup` displays current origin, block reason, matched credentials, and a `Fill` action.
- `Web Vault` remains the unlock source. It publishes a short-lived credential session to the extension when unlocked and clears it on lock.

The extension must not persist the vault key or long-lived decrypted vault material. The current MVP stores session credentials in `chrome.storage.session`, not persistent extension storage.

## Matching Rules

- Allow only `https://` origins.
- Match credentials by exact normalized origin.
- Do not fill HTTP pages.
- Do not fill cross-origin iframes.
- Do not fill hidden, invisible, disabled, or readonly fields.
- Do not submit forms automatically.

eTLD+1 suggestions and phishing similarity warnings are deferred until the next hardening pass. They must be shown as warnings, not automatic fill matches.

## Web Vault Work

- Keep CSV import in Web Vault, not the popup.
- Parse browser-exported CSV only in browser memory.
- Encrypt imported rows into the local vault before local persistence or cloud sync.
- Publish unlocked credentials to the extension only after successful unlock.
- Clear the extension session when the Web Vault locks.

## Tests

- Unit-test form detection for visible login forms and blocked hidden fields.
- Unit-test origin matching for exact HTTPS matches and similar-domain misses.
- Integration-test background session routing with a mocked Chrome extension API.
- Test confirmed fill against DOM login forms, including the guarantee that fill does not submit.
- Keep `apps/extension/fixtures/https-login.html` as the local HTTPS login fixture for future Playwright/manual browser validation.
- Add full browser E2E with a real unpacked extension before shipping Phase 3.

## Exit Criteria

- Extension build passes.
- Popup shows exact-origin candidates from an unlocked Web Vault.
- `Fill` populates username/password fields only after user confirmation.
- Locking Web Vault clears extension candidates.
- CSV import never writes plaintext rows to `localStorage`.
- Rust crypto-core tests and WASM build pass on the local Rust toolchain.
- Phase 3 docs and `docs/autofill.md` stay in sync with permission and matching changes.
