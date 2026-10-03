#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly INPUT_APK="${1:-}"
readonly OUTPUT_DIR="${2:-}"
readonly STORE_FILE=/run/zero-vault-secrets/release.keystore
readonly BUILD_TOOLS="${ANDROID_HOME:?ANDROID_HOME is required}/build-tools/36.0.0"
readonly APKSIGNER="$BUILD_TOOLS/apksigner"
readonly ZIPALIGN="$BUILD_TOOLS/zipalign"
readonly APKANALYZER="${ANDROID_HOME}/cmdline-tools/latest/bin/apkanalyzer"
readonly READELF="${ANDROID_HOME}/ndk/27.1.12297006/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "Missing required signing value: $name"
}

for name in \
  ZERO_VAULT_ANDROID_STORE_PASSWORD \
  ZERO_VAULT_ANDROID_KEY_ALIAS \
  ZERO_VAULT_ANDROID_KEY_PASSWORD \
  ZERO_VAULT_ANDROID_SIGNING_CERT_SHA256 \
  ZERO_VAULT_ANDROID_VERSION_CODE \
  ZERO_VAULT_RELEASE_ENV_SHA256; do
  require_value "$name"
done

[[ "$INPUT_APK" == /input/app-release-unsigned.apk ]] ||
  fail "The signing input must use the fixed read-only APK path"
[[ "$OUTPUT_DIR" == /output ]] ||
  fail "The signing output must use the fixed isolated output path"
[[ "$STORE_FILE" == /run/zero-vault-secrets/release.keystore ]] ||
  fail "The keystore must use the fixed read-only container path"
[[ -f "$INPUT_APK" && ! -L "$INPUT_APK" && -s "$INPUT_APK" ]] ||
  fail "Unsigned release APK is missing or invalid"
[[ -f "$STORE_FILE" && ! -L "$STORE_FILE" && -s "$STORE_FILE" ]] ||
  fail "Release keystore is missing or invalid"
[[ -d "$OUTPUT_DIR" && ! -L "$OUTPUT_DIR" ]] ||
  fail "Signing output directory is missing or invalid"
[[ -z "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]] ||
  fail "Signing output directory must be empty"
[[ -x "$APKSIGNER" && -x "$ZIPALIGN" && -x "$APKANALYZER" && -x "$READELF" ]] ||
  fail "Pinned Android signing tools are unavailable"
mkdir -p "${HOME:?HOME is required}"

(( ${#ZERO_VAULT_ANDROID_STORE_PASSWORD} >= 12 &&
   ${#ZERO_VAULT_ANDROID_STORE_PASSWORD} <= 1024 )) ||
  fail "Store password length is outside the accepted range"
(( ${#ZERO_VAULT_ANDROID_KEY_PASSWORD} >= 12 &&
   ${#ZERO_VAULT_ANDROID_KEY_PASSWORD} <= 1024 )) ||
  fail "Key password length is outside the accepted range"
[[ "$ZERO_VAULT_ANDROID_KEY_ALIAS" =~ ^[A-Za-z0-9._-]{3,128}$ ]] ||
  fail "Key alias has an invalid format"
[[ "$ZERO_VAULT_ANDROID_VERSION_CODE" =~ ^[1-9][0-9]*$ ]] &&
  (( ZERO_VAULT_ANDROID_VERSION_CODE > 1 &&
     ZERO_VAULT_ANDROID_VERSION_CODE <= 2100000000 )) ||
  fail "versionCode is outside the accepted range"
[[ "$ZERO_VAULT_RELEASE_ENV_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "release.env digest is invalid"

expected_cert="$(
  printf '%s' "$ZERO_VAULT_ANDROID_SIGNING_CERT_SHA256" |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
[[ "$expected_cert" =~ ^[0-9A-F]{64}$ &&
   "$expected_cert" != 0000000000000000000000000000000000000000000000000000000000000000 ]] ||
  fail "Expected signing certificate SHA-256 is invalid"

if "$APKSIGNER" verify "$INPUT_APK" >/dev/null 2>&1; then
  fail "Refusing an APK that is already signed"
fi

readonly WORK_DIR=/tmp/zero-vault-personal-sign
readonly ALIGNED_APK="$WORK_DIR/app-release-aligned.apk"
readonly SIGNED_APK="$OUTPUT_DIR/zero-vault-personal-release.apk"
readonly SCAN_DIR="$WORK_DIR/apk-scan"
mkdir -m 700 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

"$ZIPALIGN" -P 16 -f 4 "$INPUT_APK" "$ALIGNED_APK"
"$APKSIGNER" sign \
  --ks "$STORE_FILE" \
  --ks-key-alias "$ZERO_VAULT_ANDROID_KEY_ALIAS" \
  --ks-pass env:ZERO_VAULT_ANDROID_STORE_PASSWORD \
  --key-pass env:ZERO_VAULT_ANDROID_KEY_PASSWORD \
  --v4-signing-enabled false \
  --out "$SIGNED_APK" \
  "$ALIGNED_APK" \
  >"$OUTPUT_DIR/sign-operation.txt"
printf '%s\n' signed=true >>"$OUTPUT_DIR/sign-operation.txt"

"$APKSIGNER" verify --verbose --print-certs "$SIGNED_APK" \
  >"$OUTPUT_DIR/apk-signature.txt"
grep -Fqx 'Verified using v2 scheme (APK Signature Scheme v2): true' \
  "$OUTPUT_DIR/apk-signature.txt" ||
  fail "APK Signature Scheme v2 verification failed"
signer_count="$(
  grep -Ec '^Signer #[0-9]+ certificate SHA-256 digest: [0-9A-Fa-f]{64}$' \
    "$OUTPUT_DIR/apk-signature.txt"
)"
[[ "$signer_count" == 1 ]] || fail "Release APK must contain exactly one signer"
grep -Eq '^Signer #1 certificate SHA-256 digest: [0-9A-Fa-f]{64}$' \
  "$OUTPUT_DIR/apk-signature.txt" ||
  fail "Release APK signer #1 certificate is missing"
! grep -Eq '^Signer #[2-9][0-9]* certificate ' "$OUTPUT_DIR/apk-signature.txt" ||
  fail "Release APK contains an unexpected additional signer"

actual_cert="$(
  sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
    "$OUTPUT_DIR/apk-signature.txt" |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
[[ "$actual_cert" == "$expected_cert" ]] ||
  fail "Release APK signer does not match the expected certificate"

"$ZIPALIGN" -c -P 16 -v 4 "$SIGNED_APK" >"$OUTPUT_DIR/zipalign-16k.txt"
actual_version_code="$("$APKANALYZER" manifest version-code "$SIGNED_APK")"
actual_version_name="$("$APKANALYZER" manifest version-name "$SIGNED_APK")"
actual_application_id="$("$APKANALYZER" manifest application-id "$SIGNED_APK")"
[[ "$actual_version_code" == "$ZERO_VAULT_ANDROID_VERSION_CODE" ]] ||
  fail "Signed APK versionCode does not match release.env"
[[ -n "$actual_version_name" ]] || fail "Signed APK versionName is empty"
[[ "$actual_application_id" == com.zerovault.mobile ]] ||
  fail "Signed APK applicationId is invalid"
[[ "$("$APKANALYZER" manifest debuggable "$SIGNED_APK")" == false ]] ||
  fail "Signed APK is debuggable"
[[ "$("$APKANALYZER" manifest min-sdk "$SIGNED_APK")" == 26 ]] ||
  fail "Signed APK minSdk is invalid"
[[ "$("$APKANALYZER" manifest target-sdk "$SIGNED_APK")" == 36 ]] ||
  fail "Signed APK targetSdk is invalid"
"$APKANALYZER" manifest permissions "$SIGNED_APK" \
  >"$OUTPUT_DIR/manifest-permissions.txt"
if grep -Fqx 'android.permission.QUERY_ALL_PACKAGES' \
  "$OUTPUT_DIR/manifest-permissions.txt"; then
  fail "Signed APK requests the Play-restricted QUERY_ALL_PACKAGES permission"
fi

mkdir -m 700 "$SCAN_DIR"
unzip -q "$SIGNED_APK" -d "$SCAN_DIR"
[[ -s "$SCAN_DIR/lib/arm64-v8a/libcrypto_core.so" ]] ||
  fail "arm64 Rust crypto-core is missing from the signed APK"
[[ -s "$SCAN_DIR/lib/x86_64/libcrypto_core.so" ]] ||
  fail "x86_64 Rust crypto-core is missing from the signed APK"
[[ ! -d "$SCAN_DIR/lib/armeabi-v7a" && ! -d "$SCAN_DIR/lib/x86" ]] ||
  fail "Unexpected 32-bit ABI found in signed APK"

elf_count=0
while IFS= read -r -d '' shared_object; do
  elf_count=$((elf_count + 1))
  load_count=0
  while IFS= read -r alignment; do
    load_count=$((load_count + 1))
    (( alignment >= 16384 )) ||
      fail "An ELF LOAD segment is not aligned to 16 KiB"
  done < <("$READELF" -lW "$shared_object" | awk '$1 == "LOAD" { print $NF }')
  (( load_count > 0 )) || fail "An ELF file has no LOAD segment"
done < <(find "$SCAN_DIR" -type f -name '*.so' -print0)
(( elf_count > 0 )) || fail "No ELF files were found in the signed APK"

contains_exact() {
  local value="$1"
  grep -F -a -q -- "$value" "$SIGNED_APK" ||
    grep -R -F -a -q -- "$value" "$SCAN_DIR"
}

keystore_sha256="$(sha256sum "$STORE_FILE" | awk '{print $1}')"
for exact_value in \
  "$ZERO_VAULT_ANDROID_STORE_PASSWORD" \
  "$ZERO_VAULT_ANDROID_KEY_PASSWORD" \
  "$(basename "$STORE_FILE")" \
  "$keystore_sha256" \
  release.env \
  "$ZERO_VAULT_RELEASE_ENV_SHA256"; do
  if contains_exact "$exact_value"; then
    fail "Exact signing material was found in the signed APK"
  fi
done

generic_secret_pattern='-----BEGIN ((RSA|EC|OPENSSH) )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|sk_(live|prod)_[A-Za-z0-9]{16,}|//[^[:space:]]+:_authToken=[^[:space:]]+|npm_[A-Za-z0-9]{36}([^A-Za-z0-9]|$)|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|ZERO_VAULT_ANDROID_(STORE_PASSWORD|KEY_PASSWORD|STORE_FILE)'
if grep -R -a -q -E -- "$generic_secret_pattern" "$SCAN_DIR"; then
  fail "Generic sensitive material was found in the signed APK"
fi

printf '%s\n' \
  "applicationId=$actual_application_id" \
  "versionName=$actual_version_name" \
  "versionCode=$actual_version_code" \
  >"$OUTPUT_DIR/version.txt"
printf '%s\n' "SHA256=$actual_cert" >"$OUTPUT_DIR/signing-cert.txt"
printf '%s\n' "checkedElfFiles=$elf_count" >"$OUTPUT_DIR/elf-16k.txt"
printf '%s\n' clean >"$OUTPUT_DIR/sensitive-string-findings.txt"
(
  cd "$OUTPUT_DIR"
  sha256sum zero-vault-personal-release.apk >artifact-SHA256SUMS
)
