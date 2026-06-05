# Browser Compatibility Matrix

Last updated: 2026-06-04

## Supported Browsers

| Feature | Chrome 120+ | Edge 120+ | Notes |
| --- | --- | --- | --- |
| Web Vault (Next.js) | Full | Full | Standard web app; no browser-specific APIs required. |
| Extension install (unpacked) | Full | Full | MV3 manifest supported in both. |
| Extension install (store) | Needs listing | Needs listing | Chrome Web Store and Edge Add-ons accounts required. |
| Session bridge | Full | Full | `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`. |
| Form detection | Full | Full | DOM-based detection; no browser-specific selectors. |
| Confirmed fill | Full | Full | `chrome.scripting.executeScript` in both browsers. |
| HTTPS-only origin matching | Full | Full | Content script injected via `host_permissions: ["https://*/*"]`. |
| Phishing classification | Full | Full | Exact, similar, suspicious origin matching. |
| Hidden/disabled/readonly field blocking | Full | Full | DOM attribute checks; consistent across Chromium. |
| Cross-origin iframe blocking | Full | Full | `window.top` comparison in content script. |
| `chrome.storage.session` | Full | Full | Used for extension session cache; cleared on vault lock. |
| Service worker (MV3 background) | Full | Full | Both browsers support MV3 service workers. |

## Known Limitations

### Extension ID Configuration

`NEXT_PUBLIC_EXTENSION_ID` must be manually set to the unpacked extension's ID. This ID differs between Chrome and Edge even for the same extension source. In production, pick one browser for the primary listing and set the corresponding ID.

### `host_permissions` Scope

The extension declares `host_permissions: ["https://*/*"]` to run the content script on all HTTPS pages. This is broader than a per-site approach. Chrome may show a permissions warning during install. This is an accepted trade-off for a general-purpose password manager.

### Autofill Timing

Content script injection timing may vary between Chrome and Edge, especially on SPAs with dynamic form rendering. The form detection module uses a MutationObserver to handle late-loading forms, but edge cases may exist on heavily dynamic sites.

### CSS Selector Differences

Both Chrome and Edge are Chromium-based, so CSS selector behavior for field detection is identical. No Firefox support is planned for the initial release.

### `activeTab` Behavior

Chrome's `activeTab` permission grants temporary access only when the user interacts with the extension (clicks the popup or uses a keyboard shortcut). This is consistent with Edge's implementation.

## Testing Checklist

### Pre-Release Manual Testing

Perform on both Chrome and Edge with the unpacked extension loaded.

#### Session Bridge

- [ ] Open Web Vault, create a vault, unlock it.
- [ ] Verify extension popup shows "connected" status.
- [ ] Lock the vault in Web Vault.
- [ ] Verify extension popup shows "disconnected" and session cache is cleared.

#### Form Detection and Fill

- [ ] Navigate to a login form on an HTTPS site.
- [ ] Click the extension popup; verify the credential appears in the picker.
- [ ] Confirm fill; verify username and password are inserted.
- [ ] Navigate to a login form on an HTTP site; verify fill is blocked.
- [ ] Navigate to a login form inside a cross-origin iframe; verify fill is blocked.
- [ ] Test on a form with hidden fields; verify hidden fields are not filled.
- [ ] Test on a form with readonly/disabled fields; verify they are not filled.

#### Phishing Protection

- [ ] Test on an exact-match domain; verify fill proceeds.
- [ ] Test on a similar domain (e.g., `examp1e.com` vs `example.com`); verify warning appears.
- [ ] Test on a completely different domain; verify fill is blocked.

#### Dynamic Forms

- [ ] Test on a SPA where the login form loads after initial page render.
- [ ] Verify MutationObserver detects the late-loading form.
- [ ] Test on a site with multiple forms on one page.

#### Popup Behavior

- [ ] Open popup; verify credential list renders.
- [ ] Search for a credential; verify filtering works.
- [ ] Copy a password from the popup; verify clipboard write succeeds.
- [ ] Verify popup does not leak credentials to the page context.

### Automated Testing

- [ ] `npx pnpm test:e2e` passes (Playwright, headless Chromium).
- [ ] Extension unit tests pass: `npx pnpm --filter @zero-vault/extension test`.

## Browser-Specific Notes

### Chrome

- Manifest V3 service worker lifecycle: the background service worker may be terminated after 30 seconds of inactivity. The extension uses event-driven architecture to handle this.
- Chrome Web Store review may flag `host_permissions: ["https://*/*"]`; prepare a justification explaining it is required for a password manager's content script.

### Edge

- Edge uses the same Chromium engine as Chrome; extension behavior should be identical.
- Edge Add-ons review process is separate from Chrome Web Store.
- Edge may show a different permissions warning UI during install.
