# Autofill

Last updated: 2026-10-03

## Browser extension 0.2.0

The extension is an independent approved device. It connects an existing account, receives an X25519-encrypted shared vault key, protects its local vault and identity with Argon2id/XChaCha20-Poly1305, and uses device-bound bearer sessions for item-level cloud sync. It no longer accepts plaintext vault sessions or fill commands from websites. Chrome/Edge and Firefox have separate manifests/background builds with shared business logic.

## User-confirmed generation, capture and fill

Password generation works while locked, uses WebCrypto random bytes with rejection sampling, and supports length 8–128 and selected character classes. Copy and fill are separate user actions. Filling never submits a form. The native input setter and input/change events support controlled form frameworks.

Capture reads a recognized, visible top-level HTTPS login form only when the user submits it or clicks its submit button. Forms with multiple password fields, new-password or one-time-code fields are excluded from login capture. Vault/API sites are excluded. A same-origin navigation or disappeared login form makes the submission eligible for a save prompt; this is not proof of successful authentication. A still-visible failed form produces no page save prompt. Cross-origin redirects retain only a masked candidate in the plugin UI. Unrecognized forms and cross-origin iframe logins are not captured; users can use the generator's copy action and manage those entries in the Web Vault.

Save prompts run in a web-accessible extension-origin iframe. Website JS cannot read its contents or access the extension's keys. The background checks extension sender ID, exact prompt/popup URL, candidate ID, original tab and HTTPS origin. Prompts show origin, username and fixed password masking, never plaintext passwords. The master password is entered only in a top-level extension page. Save/update requires a user action; duplicate passwords are not offered again. Multiple same-origin/same-username records require selection. Declining clears the candidate; site exclusions persist only origin metadata.

Candidates live only in restricted storage.session for up to five minutes, and clear on tab close, lock or browser restart. Persistent storage contains encrypted vault/identity and encrypted sync operations, with non-secret sync metadata and excluded origins. The default unlock idle deadline is five minutes, checked before protected operations and by an alarm.

## Matching and field boundaries

Only an exact normalized HTTPS origin (scheme, host and port) may receive saved credentials. Similar origins and suspicious domains are displayed as blocked; there is no acknowledgment override. Before sending, the background rechecks navigation; the content script checks the expected origin and field visibility immediately before filling.

Never fill HTTP pages, hidden/invisible/zero-size inputs, disabled or readonly inputs, unrelated text fields, or cross-origin iframes. Content injection targets only the top-level document. Explicit new-password filling may fill declared new-password confirmation fields in the same form. Saved TOTP seeds remain inside the vault; only an explicitly requested current code is returned to the trusted popup.

## Permissions and packaging review

Permissions are activeTab, scripting, storage, alarms; host_permissions cover HTTPS sites. alarms is added for idle cleanup and minute-based sync. scripting injects only the top-level content script for an explicit fill if the page predates installation, then rechecks the origin. Neither cookies, webRequest, clipboardRead nor clipboardWrite is requested. Clipboard writes use a foreground user action and fall back to manual selection on denial. New external website messaging is disabled. Only save-prompt.html, its script and stylesheet are web-accessible; WASM and vault/background assets are not.

The CSP permits bundled WebAssembly with wasm-unsafe-eval and disallows objects; no remote script execution or unsafe-eval is added. Production packages contain only manifest, extension pages, stylesheet, bundles and WASM. A localhost API override is confined to test builds and is excluded from release packaging. Firefox's declared data categories reflect authentication and website data sent through the encrypted vault sync flow.

Installation and current verification: [extension installation](../apps/extension/INSTALL.md), [verification](../apps/extension/VERIFICATION.md).

## Android

The Android code for API 26–33 uses `AutofillService`; API 34+ also provides a password-only Credential Provider. Native App matching requires package name plus signing-certificate SHA-256 from the encrypted login item's optional `androidAssociations`. Web origin resolution additionally requires a personal-release browser package/certificate allowlist; an empty or invalid allowlist fails closed. API 26–27 Web forms fail closed because the platform cannot provide a trusted `webScheme`, while native package+certificate matching remains available. System services call Kotlin `VaultRepository` directly and do not depend on React Native. No passkey, Accessibility Service, overlay, automatic fill or automatic submit is permitted in v1. Detailed status and flows are in `docs/android-dev/autofill-credential-provider.md`.
