#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly INPUT_AAB="${1:-}"
readonly OUTPUT_DIR="${2:-}"
readonly STORE_FILE=/run/zero-vault-play-secrets/upload.keystore
readonly BUNDLETOOL_JAR="${BUNDLETOOL_JAR:-/opt/bundletool/bundletool.jar}"
readonly BUNDLETOOL_VERSION=1.18.3
readonly BUNDLETOOL_SHA256=a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29
readonly JARSIGNER="${JAVA_HOME:?JAVA_HOME is required}/bin/jarsigner"
readonly KEYTOOL="$JAVA_HOME/bin/keytool"
readonly APKANALYZER="${ANDROID_HOME:?ANDROID_HOME is required}/cmdline-tools/latest/bin/apkanalyzer"
readonly APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner"
readonly ZIPALIGN="$ANDROID_HOME/build-tools/36.0.0/zipalign"
readonly READELF="$ANDROID_HOME/ndk/27.1.12297006/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_value() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "Missing required Play signing value: $name"
}

for name in \
  ZERO_VAULT_ANDROID_PLAY_STORE_TYPE \
  ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD \
  ZERO_VAULT_ANDROID_PLAY_KEY_ALIAS \
  ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD \
  ZERO_VAULT_ANDROID_PLAY_UPLOAD_CERT_SHA256 \
  ZERO_VAULT_ANDROID_VERSION_CODE \
  ZERO_VAULT_PLAY_RELEASE_ENV_SHA256 \
  ZERO_VAULT_EXPECTED_API_URL \
  ZERO_VAULT_EXPECTED_API_URL_SHA256 \
  ZERO_VAULT_EXPECTED_ALLOWLIST_SHA256; do
  require_value "$name"
done

[[ "$INPUT_AAB" == /input/app-release-unsigned.aab ]] ||
  fail "The Play signing input must use the fixed read-only AAB path"
[[ "$OUTPUT_DIR" == /output ]] ||
  fail "The Play signing output must use the fixed isolated output path"
[[ -f "$INPUT_AAB" && ! -L "$INPUT_AAB" && -s "$INPUT_AAB" ]] ||
  fail "Unsigned release AAB is missing or invalid"
[[ -f "$STORE_FILE" && ! -L "$STORE_FILE" && -s "$STORE_FILE" ]] ||
  fail "Play upload keystore is missing or invalid"
[[ -d "$OUTPUT_DIR" && ! -L "$OUTPUT_DIR" ]] ||
  fail "Play signing output directory is missing or invalid"
[[ -z "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]] ||
  fail "Play signing output directory must be empty"
for tool in \
  "$BUNDLETOOL_JAR" \
  "$JARSIGNER" \
  "$KEYTOOL" \
  "$APKANALYZER" \
  "$APKSIGNER" \
  "$ZIPALIGN" \
  "$READELF"; do
  [[ -f "$tool" && -r "$tool" ]] || fail "A pinned Play signing tool is unavailable"
done
mkdir -p "${HOME:?HOME is required}"

case "$ZERO_VAULT_ANDROID_PLAY_STORE_TYPE" in
  JKS|PKCS12) ;;
  *) fail "Play keystore type must be JKS or PKCS12" ;;
esac
(( ${#ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD} >= 12 &&
   ${#ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD} <= 1024 )) ||
  fail "Play store password length is outside the accepted range"
(( ${#ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD} >= 12 &&
   ${#ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD} <= 1024 )) ||
  fail "Play key password length is outside the accepted range"
[[ "$ZERO_VAULT_ANDROID_PLAY_KEY_ALIAS" =~ ^[A-Za-z0-9._-]{3,128}$ ]] ||
  fail "Play key alias has an invalid format"
[[ "$ZERO_VAULT_ANDROID_VERSION_CODE" =~ ^[1-9][0-9]*$ ]] &&
  (( ZERO_VAULT_ANDROID_VERSION_CODE > 1 &&
     ZERO_VAULT_ANDROID_VERSION_CODE <= 2100000000 )) ||
  fail "versionCode is outside the accepted range"
[[ "$ZERO_VAULT_PLAY_RELEASE_ENV_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Play release.env digest is invalid"
[[ "$ZERO_VAULT_EXPECTED_API_URL" == https://* &&
   "$ZERO_VAULT_EXPECTED_API_URL_SHA256" =~ ^[0-9a-f]{64}$ &&
   "$ZERO_VAULT_EXPECTED_ALLOWLIST_SHA256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Expected production configuration evidence is invalid"
[[ "$(printf '%s' "$ZERO_VAULT_EXPECTED_API_URL" | sha256sum | awk '{print $1}')" ==
   "$ZERO_VAULT_EXPECTED_API_URL_SHA256" ]] ||
  fail "Expected production API URL digest is invalid"

expected_cert="$(
  printf '%s' "$ZERO_VAULT_ANDROID_PLAY_UPLOAD_CERT_SHA256" |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
[[ "$expected_cert" =~ ^[0-9A-F]{64}$ &&
   "$expected_cert" != 0000000000000000000000000000000000000000000000000000000000000000 ]] ||
  fail "Expected Play upload certificate SHA-256 is invalid"

[[ "$(bundletool version)" == "$BUNDLETOOL_VERSION" ]] ||
  fail "Pinned bundletool version is invalid"
echo "$BUNDLETOOL_SHA256  $BUNDLETOOL_JAR" | sha256sum -c - >/dev/null ||
  fail "Pinned bundletool digest is invalid"

if unzip -Z1 "$INPUT_AAB" |
  grep -Eiq '^META-INF/[^/]+\.(SF|RSA|DSA|EC)$'; then
  fail "Refusing an AAB that already contains a JAR signature"
fi

readonly WORK_DIR=/tmp/zero-vault-play-sign
readonly SIGNED_AAB="$OUTPUT_DIR/zero-vault-play-release.aab"
readonly APKS_ARCHIVE="$WORK_DIR/universal.apks"
readonly UNIVERSAL_APK="$WORK_DIR/universal.apk"
readonly AAB_SCAN_DIR="$WORK_DIR/aab-scan"
readonly APK_SCAN_DIR="$WORK_DIR/apk-scan"
readonly STORE_PASSWORD_FILE="$WORK_DIR/store-password"
readonly KEY_PASSWORD_FILE="$WORK_DIR/key-password"
mkdir -m 700 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT

printf '%s' "$ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD" >"$STORE_PASSWORD_FILE"
printf '%s' "$ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD" >"$KEY_PASSWORD_FILE"
chmod 0600 "$STORE_PASSWORD_FILE" "$KEY_PASSWORD_FILE"

cp "$INPUT_AAB" "$SIGNED_AAB"
chmod 0600 "$SIGNED_AAB"
"$JARSIGNER" \
  -keystore "$STORE_FILE" \
  -storetype "$ZERO_VAULT_ANDROID_PLAY_STORE_TYPE" \
  -storepass:env ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD \
  -keypass:env ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD \
  -digestalg SHA-256 \
  "$SIGNED_AAB" \
  "$ZERO_VAULT_ANDROID_PLAY_KEY_ALIAS" \
  >"$OUTPUT_DIR/sign-operation.txt" 2>&1
printf '%s\n' signed=true >>"$OUTPUT_DIR/sign-operation.txt"

"$JARSIGNER" -verify -verbose -certs "$SIGNED_AAB" \
  >"$OUTPUT_DIR/aab-signature.txt" 2>&1
grep -Fq 'jar verified.' "$OUTPUT_DIR/aab-signature.txt" ||
  fail "Signed AAB JAR signature verification failed"

mapfile -t signature_blocks < <(
  unzip -Z1 "$SIGNED_AAB" |
    grep -Ei '^META-INF/[^/]+\.(RSA|DSA|EC)$'
)
mapfile -t signature_files < <(
  unzip -Z1 "$SIGNED_AAB" |
    grep -Ei '^META-INF/[^/]+\.SF$'
)
(( ${#signature_blocks[@]} == 1 && ${#signature_files[@]} == 1 )) ||
  fail "Signed AAB must contain exactly one signer"

"$KEYTOOL" -printcert -jarfile "$SIGNED_AAB" \
  >"$OUTPUT_DIR/aab-certificate.txt"
actual_cert="$(
  sed -n 's/^[[:space:]]*SHA256: //p' "$OUTPUT_DIR/aab-certificate.txt" |
    head -1 |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
[[ "$actual_cert" == "$expected_cert" ]] ||
  fail "Signed AAB upload certificate does not match the expected certificate"

bundletool validate --bundle="$SIGNED_AAB" \
  >"$OUTPUT_DIR/bundletool-validate.txt" 2>&1
printf '%s\n' validated=true >>"$OUTPUT_DIR/bundletool-validate.txt"
bundletool build-apks \
  --bundle="$SIGNED_AAB" \
  --output="$APKS_ARCHIVE" \
  --mode=universal \
  --ks="$STORE_FILE" \
  --ks-key-alias="$ZERO_VAULT_ANDROID_PLAY_KEY_ALIAS" \
  --ks-pass="file:$STORE_PASSWORD_FILE" \
  --key-pass="file:$KEY_PASSWORD_FILE" \
  >"$OUTPUT_DIR/bundletool-build-apks.txt" 2>&1
printf '%s\n' buildApks=true >>"$OUTPUT_DIR/bundletool-build-apks.txt"

mapfile -t universal_entries < <(
  unzip -Z1 "$APKS_ARCHIVE" | grep -Fx universal.apk
)
(( ${#universal_entries[@]} == 1 )) ||
  fail "bundletool did not produce exactly one universal APK"
unzip -p "$APKS_ARCHIVE" universal.apk >"$UNIVERSAL_APK"
[[ -s "$UNIVERSAL_APK" ]] || fail "bundletool universal APK is empty"

"$APKSIGNER" verify --verbose --print-certs "$UNIVERSAL_APK" \
  >"$OUTPUT_DIR/universal-apk-signature.txt"
grep -Fqx 'Verified using v2 scheme (APK Signature Scheme v2): true' \
  "$OUTPUT_DIR/universal-apk-signature.txt" ||
  fail "bundletool universal APK v2 signature is invalid"
[[ "$(
  grep -Ec '^Signer #[0-9]+ certificate SHA-256 digest: [0-9A-Fa-f]{64}$' \
    "$OUTPUT_DIR/universal-apk-signature.txt"
)" == 1 ]] || fail "bundletool universal APK must contain exactly one signer"
universal_cert="$(
  sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
    "$OUTPUT_DIR/universal-apk-signature.txt" |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
[[ "$universal_cert" == "$expected_cert" ]] ||
  fail "bundletool universal APK signer is invalid"
"$ZIPALIGN" -c -P 16 -v 4 "$UNIVERSAL_APK" \
  >"$OUTPUT_DIR/universal-zipalign-16k.txt"

bundletool dump manifest \
  --bundle="$SIGNED_AAB" \
  --module=base \
  --output="$OUTPUT_DIR/manifest.xml"
[[ -s "$OUTPUT_DIR/manifest.xml" ]] ||
  fail "bundletool did not produce the base manifest"

actual_version_code="$("$APKANALYZER" manifest version-code "$UNIVERSAL_APK")"
actual_version_name="$("$APKANALYZER" manifest version-name "$UNIVERSAL_APK")"
actual_application_id="$("$APKANALYZER" manifest application-id "$UNIVERSAL_APK")"
[[ "$actual_version_code" == "$ZERO_VAULT_ANDROID_VERSION_CODE" ]] ||
  fail "Signed AAB versionCode does not match release.env"
[[ -n "$actual_version_name" ]] || fail "Signed AAB versionName is empty"
[[ "$actual_application_id" == com.zerovault.mobile ]] ||
  fail "Signed AAB applicationId is invalid"
[[ "$("$APKANALYZER" manifest debuggable "$UNIVERSAL_APK")" == false ]] ||
  fail "Signed AAB is debuggable"
[[ "$("$APKANALYZER" manifest min-sdk "$UNIVERSAL_APK")" == 26 ]] ||
  fail "Signed AAB minSdk is invalid"
[[ "$("$APKANALYZER" manifest target-sdk "$UNIVERSAL_APK")" == 36 ]] ||
  fail "Signed AAB targetSdk is invalid"
"$APKANALYZER" manifest permissions "$UNIVERSAL_APK" \
  >"$OUTPUT_DIR/manifest-permissions.txt"
if grep -Fqx 'android.permission.QUERY_ALL_PACKAGES' \
  "$OUTPUT_DIR/manifest-permissions.txt"; then
  fail "Signed AAB requests the Play-restricted QUERY_ALL_PACKAGES permission"
fi

mkdir -m 700 "$AAB_SCAN_DIR" "$APK_SCAN_DIR"
unzip -q "$SIGNED_AAB" -d "$AAB_SCAN_DIR"
unzip -q "$UNIVERSAL_APK" -d "$APK_SCAN_DIR"
[[ -s "$APK_SCAN_DIR/assets/index.android.bundle" ]] ||
  fail "React Native production bundle is missing from the signed AAB"
api_occurrences="$(
  { grep -aFo -- "$ZERO_VAULT_EXPECTED_API_URL" \
      "$APK_SCAN_DIR/assets/index.android.bundle" || true; } |
    wc -l |
    tr -d ' '
)"
[[ "$api_occurrences" == 1 ]] ||
  fail "Signed AAB does not contain exactly one expected production API URL"

allowlist_matches=0
allowlist_resource=""
while IFS= read -r -d '' resource; do
  embedded_json="$(jq -ceS . "$resource" 2>/dev/null || true)"
  [[ -n "$embedded_json" ]] || continue
  embedded_sha256="$(printf '%s' "$embedded_json" | sha256sum | awk '{print $1}')"
  if [[ "$embedded_sha256" == "$ZERO_VAULT_EXPECTED_ALLOWLIST_SHA256" ]]; then
    allowlist_matches=$((allowlist_matches + 1))
    allowlist_resource="${resource#"$APK_SCAN_DIR"/}"
  fi
done < <(find "$APK_SCAN_DIR/res" -type f -name '*.json' -print0)
[[ "$allowlist_matches" == 1 ]] ||
  fail "Signed AAB does not contain exactly one expected privileged-caller allowlist"

[[ -s "$APK_SCAN_DIR/lib/arm64-v8a/libcrypto_core.so" ]] ||
  fail "arm64 Rust crypto-core is missing from the signed AAB"
[[ -s "$APK_SCAN_DIR/lib/x86_64/libcrypto_core.so" ]] ||
  fail "x86_64 Rust crypto-core is missing from the signed AAB"
[[ ! -d "$APK_SCAN_DIR/lib/armeabi-v7a" && ! -d "$APK_SCAN_DIR/lib/x86" ]] ||
  fail "Unexpected 32-bit ABI found in the signed AAB"

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
done < <(find "$APK_SCAN_DIR" -type f -name '*.so' -print0)
(( elf_count > 0 )) || fail "No ELF files were found in the signed AAB"

contains_exact() {
  local value="$1"
  grep -F -a -q -- "$value" "$SIGNED_AAB" ||
    grep -R -F -a -q -- "$value" "$AAB_SCAN_DIR" "$APK_SCAN_DIR"
}

keystore_sha256="$(sha256sum "$STORE_FILE" | awk '{print $1}')"
for exact_value in \
  "$ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD" \
  "$ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD" \
  "$(basename "$STORE_FILE")" \
  "$keystore_sha256" \
  release.env \
  "$ZERO_VAULT_PLAY_RELEASE_ENV_SHA256"; do
  if contains_exact "$exact_value"; then
    fail "Exact Play signing material was found in the signed AAB"
  fi
done

generic_secret_pattern='-----BEGIN ((RSA|EC|OPENSSH) )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|sk_(live|prod)_[A-Za-z0-9]{16,}|//[^[:space:]]+:_authToken=[^[:space:]]+|npm_[A-Za-z0-9]{36}([^A-Za-z0-9]|$)|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|ZERO_VAULT_ANDROID_PLAY_(STORE_PASSWORD|KEY_PASSWORD|STORE_FILE)'
if grep -R -a -q -E -- "$generic_secret_pattern" \
  "$AAB_SCAN_DIR" "$APK_SCAN_DIR"; then
  fail "Generic sensitive material was found in the signed AAB"
fi

printf '%s\n' \
  "AAB API URL occurrences: $api_occurrences" \
  "Embedded API URL SHA-256: $ZERO_VAULT_EXPECTED_API_URL_SHA256" \
  "Embedded privileged caller resource: $allowlist_resource" \
  "Embedded privileged caller SHA-256: $ZERO_VAULT_EXPECTED_ALLOWLIST_SHA256" \
  'Final embedded configuration verification: passed' \
  >"$OUTPUT_DIR/final-verification.txt"
printf '%s\n' \
  "applicationId=$actual_application_id" \
  "versionName=$actual_version_name" \
  "versionCode=$actual_version_code" \
  'minSdk=26' \
  'targetSdk=36' \
  'debuggable=false' \
  >"$OUTPUT_DIR/version.txt"
printf '%s\n' "uploadCertificateSHA256=$actual_cert" \
  >"$OUTPUT_DIR/signing-cert.txt"
printf '%s\n' \
  "version=$BUNDLETOOL_VERSION" \
  "sha256=$BUNDLETOOL_SHA256" \
  >"$OUTPUT_DIR/bundletool-version.txt"
printf '%s\n' "checkedElfFiles=$elf_count" >"$OUTPUT_DIR/elf-16k.txt"
printf '%s\n' clean >"$OUTPUT_DIR/sensitive-string-findings.txt"
(
  cd "$OUTPUT_DIR"
  sha256sum zero-vault-play-release.aab >aab-SHA256SUMS
)
