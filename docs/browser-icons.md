# Browser icons

The Web Vault uses an orange pixel lock and the extension uses a cyan pixel key on a dark tile. Both share a 32-unit grid, stepped corners and two-unit features that remain readable at 16px. SVGs contain only local geometry and solid fills, without fonts, scripts or external resources.

- Web master: `apps/web/app/icon.svg`. Next.js automatically serves it and adds the icon metadata. `favicon.ico` provides 16/32/48px fallbacks; `apple-icon.png` is the 180px home-screen icon.
- Extension master: `apps/extension/icons/icon.svg`. Firefox uses it directly for the toolbar and extension manager. Chromium uses PNG exports at 16/32/48/128px. The popup also references the SVG as its tab icon. Build and package scripts include all icon files.

PNG exports are browser renders of the SVG at the exact output size with device scale factor 1. The ICO contains the 16/32/48px PNG images. Change the SVG masters first and regenerate the raster exports together.

Platform references: [Next.js icon metadata](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons), [Firefox SVG icons](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/icons), [Chromium raster icons](https://developer.chrome.com/docs/extensions/develop/ui/configure-icons).
