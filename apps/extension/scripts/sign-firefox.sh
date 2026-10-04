#!/usr/bin/env bash
set -euo pipefail
set +x
EXTENSION_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$EXTENSION_ROOT"

# Build before requesting credentials; they never enter build output or argv.
npx --yes --package=node@24.19.0 -- node build.mjs firefox
npx --yes --package=node@24.19.0 -- node package.mjs firefox
npx --yes --package=node@24.19.0 -- node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync("build/firefox/manifest.json","utf8")); const project=JSON.parse(fs.readFileSync("package.json","utf8")); if(manifest.version!==project.version || manifest.browser_specific_settings?.gecko?.id!=="zero-vault@zero-vault.local" || manifest.host_permissions.length!==1 || manifest.host_permissions[0]!=="https://*/*") throw new Error("Not the production Firefox build");'
npx --yes --package=node@24.19.0 --package=web-ext@10.6.0 -- web-ext lint --source-dir=build/firefox --warnings-as-errors

trap 'unset WEB_EXT_API_KEY WEB_EXT_API_SECRET' EXIT
if [[ -z "${WEB_EXT_API_KEY:-}" ]]; then
  read -r -s -p 'AMO API key (hidden): ' WEB_EXT_API_KEY </dev/tty
  printf '\n'
fi
if [[ -z "${WEB_EXT_API_SECRET:-}" ]]; then
  read -r -s -p 'AMO API secret (hidden): ' WEB_EXT_API_SECRET </dev/tty
  printf '\n'
fi
if [[ -z "$WEB_EXT_API_KEY" || -z "$WEB_EXT_API_SECRET" ]]; then
  printf 'AMO credentials are required.\n' >&2
  exit 1
fi
export WEB_EXT_API_KEY WEB_EXT_API_SECRET
npx --yes --package=node@24.19.0 --package=web-ext@10.6.0 -- web-ext sign \
  --source-dir=build/firefox \
  --artifacts-dir=artifacts/firefox-signed \
  --channel=unlisted
npx --yes --package=node@24.19.0 -- node -e 'const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"); const dir="artifacts/firefox-signed"; const files=fs.readdirSync(dir).filter(file=>file.endsWith(".xpi")); if(!files.length) throw new Error("No signed XPI was downloaded"); fs.writeFileSync(path.join(dir,"SHA256SUMS"),files.map(file=>crypto.createHash("sha256").update(fs.readFileSync(path.join(dir,file))).digest("hex")+"  "+file).join("\n")+"\n");'
