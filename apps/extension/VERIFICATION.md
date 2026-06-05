# Extension Release Verification Checklist

## 1. Install Unpacked Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked** and select the `apps/extension/` directory
4. Confirm the Zero Vault extension appears with version `0.1.0`
5. Verify the extension icon appears in the toolbar
6. Pin the extension for easy access during testing

## 2. HTTPS Site Credential Save and Fill

1. Navigate to any HTTPS login page (e.g. `https://github.com/login`)
2. Click the Zero Vault extension icon to open the popup
3. Verify the popup shows the site origin and "Extension active" status
4. In the web vault, unlock the vault so credentials are published to the extension
5. If the site has credentials stored, verify they appear in the popup with `matchType: "exact"`
6. Click a credential in the popup to fill the login form
7. Verify username and password fields are filled without form submission
8. Verify the popup shows "Filled successfully" confirmation

## 3. Phishing Warning on Similar Domains

1. Store a credential for `https://example.com`
2. Navigate to `https://sub.example.com` (same eTLD+1, different subdomain)
3. Open the popup and verify the credential shows a "Similar origin" badge and warning text
4. Try to fill the similar credential -- verify it is blocked with `similar_origin_not_acknowledged` error
5. Click "I verified this site - allow fill" button in the popup
6. Verify the badge changes to "Verified" and fill now succeeds

### Punycode / IDN Homograph Protection

1. Store a credential for `https://google.com`
2. Navigate to a punycode domain like `https://xn--googl-e4d.com`
3. Verify the credential shows a "Blocked" badge and "Potential phishing detected" message
4. Verify the credential cannot be filled at all (returns `suspicious_origin` error, no acknowledge button)

## 4. Multi-Credential Picker

1. Store multiple credentials for the same origin (e.g. Personal and Work accounts for `https://example.com`)
2. Navigate to the site and open the popup
3. Verify all matching credentials are listed with title and username
4. Verify the match count text (e.g. "2 credentials matched")
5. Click a specific credential to fill it
6. Verify the correct username/password pair was filled (not a different credential)
7. Click a different credential to switch accounts
8. Verify the form is updated with the new credentials

## 5. Keyboard Navigation

1. Open the popup on a page with multiple matched credentials
2. Press **ArrowDown** or **ArrowRight** -- verify selection moves to the next credential
3. Press **ArrowUp** or **ArrowLeft** -- verify selection moves to the previous credential
4. Verify selection wraps around (last to first, first to last)
5. Verify the selected credential has a visible focus/selection outline
6. Press **Enter** -- verify the selected credential is filled
7. Navigate to a different credential with arrow keys, press **Enter** again
8. Verify the new credential is filled (confirming selection changed)

## 6. Extension <-> Web Vault Bridge Connectivity

1. Open the web vault in a browser tab
2. Unlock the vault
3. Verify the popup status shows "Extension active" with matched credential count
4. Lock the web vault
5. Verify the popup status updates (credentials disappear from the extension)
6. Open `chrome-extension://<extension-id>/bridge.html` and verify it loads

### GET_EXTENSION_STATUS Verification

From a page with `chrome.runtime` access to the extension:
1. Send `{ type: "GET_EXTENSION_STATUS" }` via `chrome.runtime.sendMessage`
2. Verify response includes `installed: true`, `version: "0.1.0"`, `credentialsLoaded` (boolean), `matchedCredentials` (number)

## 7. Session Cleared on Vault Lock

1. Unlock the web vault and verify credentials appear in the popup
2. Lock the web vault (triggers `ZERO_VAULT_SESSION_CLEAR`)
3. Verify the popup shows no credentials
4. Verify `sessionCredentials`, `lastCandidate`, and `acknowledgedOrigins` are all cleared from `chrome.storage.session`
5. Verify acknowledged similar-origin warnings are reset (re-navigating requires re-acknowledgment)

## 8. Content Script Safety Checks

### Hidden / Invisible Fields
- `type="hidden"` password fields are not detected
- `disabled` password fields are not detected
- `readonly` password fields are not detected
- `visibility: hidden` or `display: none` fields are not detected
- Zero-dimension fields are not detected

### Cross-Origin Iframes
- Forms inside cross-origin iframes are not detected by the content script
- Fill is not attempted on cross-origin iframe fields
- Same-origin iframes work normally

### HTTPS Enforcement
- HTTP pages are not scanned for login forms
- HTTP pages show "Zero Vault only fills HTTPS pages." in the popup

## 9. Manifest Permissions Audit

Verify `manifest.json` requests only these permissions:
- `activeTab` -- required for querying the active tab
- `scripting` -- required for "Scan page" button (`chrome.scripting.executeScript`)
- `storage` -- required for `chrome.storage.session` (credentials, candidates, acknowledgments)
- `host_permissions: ["https://*/*"]` -- required for content script on HTTPS pages
- `externally_connectable` -- localhost only, for web vault bridge

No additional permissions should be present.

---

## Build and Package Instructions

### Prerequisites

- Node.js >= 18
- pnpm (install globally: `npm install -g pnpm`, or use `npx pnpm`)

### Build

```bash
# From monorepo root
npx pnpm --filter @zero-vault/extension build
```

This runs:
1. TypeScript type-check (`tsc --noEmit`)
2. `esbuild` bundles three entry points:
   - `dist/background.js` (ESM, service worker)
   - `dist/popup.js` (ESM, popup script)
   - `dist/content-script.js` (IIFE, content script)

### Run Unit Tests

```bash
npx pnpm --filter @zero-vault/extension test
```

Runs Vitest with jsdom environment covering:
- `background.test.ts` -- session routing, origin matching, fill logic
- `form-detection.test.ts` -- field detection, visibility checks
- `form-fill.test.ts` -- fill safety, field rejection
- `origin-matching.test.ts` -- eTLD+1, punycode, typosquatting
- `popup.test.ts` -- keyboard navigation, credential selection

### Run E2E Tests

```bash
npx pnpm --filter @zero-vault/extension test:e2e
```

Runs Playwright with a real Chromium instance and the unpacked extension loaded. Covers:
- HTTPS form detection and fill
- Multi-credential picker
- Phishing warning and acknowledgment flow
- Session credential clearing on vault lock
- Cross-origin iframe blocking
- Hidden/disabled/readonly field blocking
- HTTP page blocking
- Stale candidate rejection (different active tab)

### Package for Distribution

```bash
cd apps/extension
# Build first
npx pnpm --filter @zero-vault/extension build

# Create a ZIP of the extension directory (excluding source, tests, node_modules)
zip -r zero-vault-extension.zip \
  manifest.json \
  popup.html \
  bridge.html \
  dist/ \
  -x "*.test.*" "*.spec.*" "node_modules/*" "src/*" "e2e/*" "fixtures/*"
```

The resulting `zero-vault-extension.zip` can be uploaded to the Chrome Web Store or loaded as an unpacked extension.
