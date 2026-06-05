# Autofill

Last updated: 2026-06-04

## Default Policy

Autofill is user-confirmed. The extension may detect forms automatically, but it must not insert credentials without explicit user action.

## Matching Rules

- Fill only on `https://` origins.
- Match credentials by exact normalized origin.
- Similar-origin domains (e.g., `examp1e.com` vs `example.com`) are classified as suspicious and shown with a warning.
- Domains classified as suspicious are blocked from auto-fill and require explicit user acknowledgment.
- Require re-confirmation for changed origins, iframe contexts, and new devices.

## Multi-Credential Popup Picker

When multiple credentials match a given origin, the extension popup displays all matches in a list:

- Each entry shows the credential title, username, and masked password.
- The user selects one credential to fill.
- Filling requires an explicit click on the "Fill" action for the selected credential.
- If no credentials match, the popup shows a "No matching credentials" message.

## Phishing Protection

The extension classifies origins into three categories:

- **Exact match:** The page origin exactly matches a saved credential origin. Fill is allowed after user confirmation.
- **Similar match:** The page origin resembles a saved credential origin (e.g., homoglyph substitutions, typos). Fill is blocked with a warning.
- **Suspicious match:** The page origin is HTTP, uses a non-standard port, or is otherwise untrusted. Fill is blocked.

The user sees the origin classification in the popup before any fill action.

## Field Rules

Never fill:

- Hidden inputs.
- Invisible or zero-size inputs.
- Disabled or readonly fields.
- Cross-origin iframes.
- Non-HTTPS pages.
- Fields outside the detected login form.

## Field Visibility Re-Check

Before performing a fill, the content script re-checks that target fields are still visible. This guards against DOM mutations that hide or disable fields after initial detection but before fill execution. If a field is no longer visible, the fill is aborted for that field.

## Cross-Origin Iframe Blocking

Credentials are never filled into cross-origin iframes. The content script compares the iframe's `src` origin against the top-level page origin. If they differ, fill is blocked for all fields within that iframe. This prevents a malicious iframe from harvesting credentials intended for the parent page.

## Extension Boundary

The content script only detects candidate fields and performs a fill request. It must not hold long-term vault keys. The background worker coordinates site matching, unlock state, and communication with the Web Vault or native host.

The extension declares `permissions: ["activeTab", "scripting", "storage"]` and `host_permissions: ["https://*/*"]` in `manifest.json`. The broad `host_permissions` grant is required for the content script to run on all HTTPS login pages. The `activeTab` permission limits API access until the user interacts with the extension action. Permission changes must be reviewed against this document.
