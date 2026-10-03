#!/usr/bin/env bash
set -euo pipefail

cd /workspace
: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"
configuration="${1:-debug}RuntimeClasspath"
case "$configuration" in debugRuntimeClasspath|releaseRuntimeClasspath) ;; *) exit 2 ;; esac

sbom_dir="$ARTIFACT_DIR/sbom"
mkdir -p "$sbom_dir"
cp pnpm-lock.yaml "$sbom_dir/pnpm-lock.yaml"
pnpm --filter @zero-vault/mobile licenses list --prod --json > "$sbom_dir/pnpm-production-licenses.json"
cargo metadata --locked --format-version 1 --manifest-path crates/crypto-core/Cargo.toml > "$sbom_dir/cargo-metadata.json"

if [[ ! -d apps/mobile/android ]]; then
  cd apps/mobile
  pnpm exec expo prebuild --platform android --clean
  cd /workspace
fi
apps/mobile/android/gradlew -p apps/mobile/android app:dependencies --configuration "$configuration" > "$sbom_dir/gradle-dependencies.txt"

fingerprint="$(sed -n 's/^fingerprint=//p' .remote-sync)"
[[ "$fingerprint" =~ ^[0-9a-f]{64}$ ]] || {
  echo "Missing or invalid synchronized source fingerprint" >&2
  exit 1
}
node scripts/mobile-generate-sbom.mjs \
  "$sbom_dir/zero-vault-mobile.cdx.json" \
  "$sbom_dir/pnpm-production-licenses.json" \
  "$sbom_dir/cargo-metadata.json" \
  "$sbom_dir/gradle-dependencies.txt" \
  "$configuration" \
  "$fingerprint"

jq -e '.bomFormat == "CycloneDX" and .specVersion == "1.5" and
  ([.components[].purl | select(startswith("pkg:npm/"))] | length > 0) and
  ([.components[].purl | select(startswith("pkg:cargo/"))] | length > 0) and
  ([.components[].purl | select(startswith("pkg:maven/"))] | length > 0)' \
  "$sbom_dir/zero-vault-mobile.cdx.json" >/dev/null
if grep -R -a -q -E -- '-----BEGIN ((RSA|EC|OPENSSH) )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|sk_(live|prod)_[A-Za-z0-9]{16,}|//[^[:space:]]+:_authToken=[^[:space:]]+|npm_[A-Za-z0-9]{36}([^A-Za-z0-9]|$)|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' "$sbom_dir"; then
  echo "Sensitive material found in SBOM evidence" >&2
  exit 1
fi
sha256sum \
  "$sbom_dir/zero-vault-mobile.cdx.json" \
  "$sbom_dir/pnpm-lock.yaml" \
  "$sbom_dir/pnpm-production-licenses.json" \
  "$sbom_dir/cargo-metadata.json" \
  "$sbom_dir/gradle-dependencies.txt" > "$sbom_dir/SHA256SUMS"
