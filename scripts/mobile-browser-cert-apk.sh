#!/usr/bin/env bash
set -euo pipefail

: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"

readonly APK="${1:-}"
readonly APKSIGNER="${ANDROID_HOME:?ANDROID_HOME is required}/build-tools/36.0.0/apksigner"
readonly APKANALYZER="${ANDROID_HOME}/cmdline-tools/latest/bin/apkanalyzer"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

[[ "$APK" == "$ARTIFACT_DIR/browser-base.apk" ]] ||
  fail "Chrome APK must use the staged artifact path"
[[ -f "$APK" && ! -L "$APK" && -s "$APK" ]] ||
  fail "Chrome APK is missing or invalid"
[[ -x "$APKSIGNER" && -x "$APKANALYZER" ]] ||
  fail "Pinned Android inspection tools are unavailable"
trap 'rm -f -- "$APK"' EXIT

"$APKSIGNER" verify --verbose --print-certs "$APK" \
  >"$ARTIFACT_DIR/browser-signature.txt"
signer_count="$(
  grep -Ec '^Signer #[0-9]+ certificate SHA-256 digest: [0-9A-Fa-f]{64}$' \
    "$ARTIFACT_DIR/browser-signature.txt"
)"
[[ "$signer_count" == 1 ]] ||
  fail "Chrome APK must contain exactly one current signer"

package_name="$("$APKANALYZER" manifest application-id "$APK")"
[[ "$package_name" == com.android.chrome ]] ||
  fail "Exported APK is not com.android.chrome"
version_name="$("$APKANALYZER" manifest version-name "$APK")"
version_code="$("$APKANALYZER" manifest version-code "$APK")"
[[ -n "$version_name" && "$version_code" =~ ^[1-9][0-9]*$ ]] ||
  fail "Chrome APK version metadata is invalid"
browser_apk_sha256="$(sha256sum "$APK" | awk '{print $1}')"
[[ "$browser_apk_sha256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Chrome APK SHA-256 is invalid"

certificate="$(
  sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
    "$ARTIFACT_DIR/browser-signature.txt" |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
[[ "$certificate" =~ ^[0-9A-F]{64}$ ]] ||
  fail "Chrome signing certificate SHA-256 is invalid"

jq -ceS -n \
  --arg certificate "$certificate" \
  '{apps:[{type:"android",info:{package_name:"com.android.chrome",signatures:[{build:"release",cert_fingerprint_sha256:$certificate}]}}]}' \
  >"$ARTIFACT_DIR/privileged-callers-device.json"
printf '%s\n' \
  'scope=owner-device-exported-apk' \
  "packageName=$package_name" \
  "versionName=$version_name" \
  "versionCode=$version_code" \
  "browserApkSha256=$browser_apk_sha256" \
  "certificateSha256=$certificate" \
  >"$ARTIFACT_DIR/browser-version.txt"
printf 'ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON=%s\n' \
  "$(cat "$ARTIFACT_DIR/privileged-callers-device.json")" \
  >"$ARTIFACT_DIR/release-env-line.txt"
(
  cd "$ARTIFACT_DIR"
  sha256sum \
    browser-signature.txt \
    browser-version.txt \
    privileged-callers-device.json \
    release-env-line.txt \
    >browser-cert-SHA256SUMS
)

echo browser-cert-device-export-complete
