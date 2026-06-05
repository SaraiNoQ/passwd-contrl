# UI Prototype Prompt

Use this prompt to generate a complete product UI prototype and visual design system for Zero Vault.

```text
Design a complete high-fidelity UI prototype for "Zero Vault", a zero-knowledge password manager for Web Vault, browser extension autofill, Android, iOS, and macOS.

Product context:
- Zero Vault stores website and app passwords securely.
- The server can only sync encrypted vault blobs and must never decrypt user data.
- The first product surface is the Web Vault, with future browser extension and mobile clients.
- Phase 1 supports local encrypted vault creation, unlock, lock, adding credentials, and encrypted local persistence.
- The UI must feel like a serious security product, not a crypto trading dashboard.

Core screens to design:
1. Web Vault locked state
   - Brand: Zero Vault
   - Master password input
   - Create vault / Unlock vault primary action
   - Clear status summary: runtime, locked/unlocked status, item count, last updated
   - Security note: master password stays on device
2. Web Vault unlocked dashboard
   - Left security/control panel with lock vault action
   - Main credentials workspace
   - Add credential form: name, HTTPS origin, username, password, notes
   - Credential list with origin, username, masked password, reveal/hide toggle
   - Empty state for a new vault
3. Browser extension popup
   - Compact 320px width layout
   - Current site origin
   - Matched credentials list
   - User-confirmed fill action
   - Locked state prompting unlock
   - Warning state for HTTP, iframe, or domain mismatch
4. Import flow
   - CSV file selection
   - Browser source selector: Chrome, Edge, Firefox
   - Row validation summary
   - Warning that CSV is plaintext and should be deleted after import
   - Import confirmation screen
5. Recovery setup
   - Recovery key packet explanation
   - Recovery code display/download/copy actions
   - Confirmation checklist
6. Sync status and device trust
   - Local-only / synced / conflict / offline states
   - Trusted devices list
   - New device approval flow
7. Mobile preview frames
   - Android vault list and AutofillService suggestion sheet
   - iOS/macOS credential provider selection view

Visual style:
- Dark-mode first Web3-inspired security interface.
- Use deep near-black backgrounds, layered translucent glass surfaces, thin luminous borders, and restrained neon accents.
- Avoid loud crypto clichés: no coins, chains, token charts, NFT imagery, or excessive purple gradients.
- Use a mature Web3 palette:
  - Background: #070A12, #0B1020, #101827
  - Primary accent: electric cyan #22D3EE
  - Success/security accent: mint green #34D399
  - Secondary accent: soft magenta #F472B6
  - Warning: amber #F59E0B
  - Danger: rose #FB7185
  - Text: #F8FAFC, #CBD5E1, #94A3B8
- Apply glassmorphism only to panels and dashboard widgets where it improves hierarchy.
- Use bento-style layout blocks for dashboard summaries, but keep credential rows dense and scannable.
- Cards and panels should have 8px radius or less.
- No decorative gradient blobs or random floating orbs.
- Typography should be crisp, technical, and readable. Do not use negative letter spacing. Do not scale font size by viewport width.
- Buttons should use recognizable icons plus labels. Use security-related icons such as lock, key, shield, eye, plus, upload, sync, device, alert.

UX requirements:
- Passwords are masked by default.
- Reveal/hide is explicit and reversible.
- Lock action is always visible after unlock.
- Add credential form must make HTTPS origin requirements clear.
- Autofill must always require user confirmation; do not design silent autofill.
- Show warnings for non-HTTPS pages, hidden fields, iframe mismatch, similar phishing domains, and sync conflicts.
- Avoid marketing-page layout. The first screen must be the usable vault experience.
- UI copy should be concise and operational, not promotional.

Design system deliverables:
- Desktop Web Vault frame: 1440x1024
- Tablet Web Vault frame: 834x1194
- Mobile Web Vault frame: 390x844
- Browser extension popup frame: 320x520
- Mobile Autofill sheet frame: 390x360
- Components: buttons, icon buttons, inputs, password fields, textarea, status badges, credential rows, warning callouts, modal, segmented control, tabs, device list row, import row validation item.
- States: locked, unlocked, empty, item added, password revealed, import warning, import success, sync conflict, offline, autofill match, autofill blocked.
- Include spacing, color, typography, and interaction notes.

Accessibility:
- Minimum contrast should pass WCAG AA.
- Focus rings must be visible on dark backgrounds.
- Touch targets at least 44px.
- Text must not overlap or truncate awkwardly on mobile.
- Warning states cannot rely on color alone.

Output expectations:
- Produce polished high-fidelity prototype screens.
- Include a compact design system page.
- Keep the look futuristic, trustworthy, and functional.
- Prioritize workflows and data density over decorative landing-page visuals.
```
