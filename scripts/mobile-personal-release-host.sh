#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SOURCE_ROOT=/root/dev/zero-vault
readonly ARTIFACTS_ROOT=/root/dev/zero-vault-artifacts
readonly SECRETS_DIR=/root/dev/zero-vault-android-secrets
readonly RELEASE_ENV="$SECRETS_DIR/release.env"
readonly RELEASE_KEYSTORE="$SECRETS_DIR/release.keystore"
readonly PRIVATE_RELEASE_ROOT=/root/.zero-vault-android-private-release
readonly CONTAINER=zero-vault-android-dev
readonly EXPECTED_IMAGE=zero-vault/android-dev:sdk57
readonly CONTAINER_STORE_FILE=/run/zero-vault-secrets/release.keystore
readonly ARTIFACT_DIR="${ARTIFACT_DIR:?ARTIFACT_DIR is required}"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

validate_private_file() {
  local file="$1"
  local label="$2"
  [[ -f "$file" && ! -L "$file" ]] || fail "$label must be a regular non-symlink file"
  [[ "$(stat -c '%F' "$file")" == "regular file" ]] ||
    fail "$label must be a regular file"
  [[ "$(stat -c '%u' "$file")" == 0 ]] || fail "$label must be owned by root"
  case "$(stat -c '%a' "$file")" in
    400|600) ;;
    *) fail "$label must have mode 400 or 600" ;;
  esac
  [[ "$(stat -c '%h' "$file")" == 1 ]] || fail "$label must not have hard links"
  [[ -s "$file" ]] || fail "$label must not be empty"
}

canonical_artifact_dir="$(readlink -f "$ARTIFACT_DIR")"
run_id="${canonical_artifact_dir#"$ARTIFACTS_ROOT"/}"
[[ "$canonical_artifact_dir" == "$ARTIFACTS_ROOT/$run_id" &&
   "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z-personal-release-[0-9]+-[0-9]+$ ]] ||
  fail "ARTIFACT_DIR is outside the dedicated personal-release run directory"
[[ -d "$canonical_artifact_dir" && ! -L "$ARTIFACT_DIR" ]] ||
  fail "ARTIFACT_DIR is missing or invalid"
readonly CONTAINER_ARTIFACT_DIR="/artifacts/$run_id"

[[ -d "$SECRETS_DIR" && ! -L "$SECRETS_DIR" ]] ||
  fail "Android secrets directory is missing or invalid"
[[ "$(stat -c '%u' "$SECRETS_DIR")" == 0 ]] ||
  fail "Android secrets directory must be owned by root"
[[ "$(stat -c '%a' "$SECRETS_DIR")" == 700 ]] ||
  fail "Android secrets directory must have mode 700"
validate_private_file "$RELEASE_ENV" release.env
validate_private_file "$RELEASE_KEYSTORE" release.keystore

[[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" == true ]] ||
  fail "Android development container is not running"
[[ "$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")" == "$EXPECTED_IMAGE" ]] ||
  fail "Android development container uses an unexpected image tag"
if docker inspect --format '{{range .Mounts}}{{println .Source "|" .Destination}}{{end}}' \
  "$CONTAINER" |
  grep -Eq 'zero-vault-android-secrets|/run/zero-vault-secrets'; then
  fail "Development container still has a secrets mount; recreate it before release"
fi
if docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" |
  grep -Eq '^ZERO_VAULT_ANDROID_(STORE_FILE|STORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD|SIGNING_CERT_SHA256)='; then
  fail "Development container has persistent Android signing environment variables"
fi
mkdir -p -m 700 "$PRIVATE_RELEASE_ROOT"
[[ -d "$PRIVATE_RELEASE_ROOT" && ! -L "$PRIVATE_RELEASE_ROOT" &&
   "$(stat -c '%u' "$PRIVATE_RELEASE_ROOT")" == 0 &&
   "$(stat -c '%a' "$PRIVATE_RELEASE_ROOT")" == 700 ]] ||
  fail "Private release staging root must be a root-owned mode-700 directory"
while IFS= read -r mount_source; do
  [[ -n "$mount_source" ]] || continue
  mount_source="$(readlink -f "$mount_source")"
  [[ "$mount_source" != / ]] ||
    fail "Development container can see the private release staging root"
  case "$PRIVATE_RELEASE_ROOT/" in
    "$mount_source/"*) fail "Development container can see the private release staging root" ;;
  esac
done < <(docker inspect --format '{{range .Mounts}}{{println .Source}}{{end}}' "$CONTAINER")

readonly EXPECTED_KEYS=(
  ZERO_VAULT_ANDROID_STORE_FILE
  ZERO_VAULT_ANDROID_STORE_PASSWORD
  ZERO_VAULT_ANDROID_KEY_ALIAS
  ZERO_VAULT_ANDROID_KEY_PASSWORD
  ZERO_VAULT_ANDROID_SIGNING_CERT_SHA256
  ZERO_VAULT_ANDROID_VERSION_CODE
  EXPO_PUBLIC_ZERO_VAULT_API_URL
  ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON
)
declare -A release=()
line_number=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line_number=$((line_number + 1))
  [[ "$line" != *$'\r'* ]] || fail "release.env contains a carriage return"
  [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] ||
    fail "release.env line $line_number is not a strict KEY=value entry"
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  case "$key" in
    ZERO_VAULT_ANDROID_STORE_FILE|ZERO_VAULT_ANDROID_STORE_PASSWORD|\
    ZERO_VAULT_ANDROID_KEY_ALIAS|ZERO_VAULT_ANDROID_KEY_PASSWORD|\
    ZERO_VAULT_ANDROID_SIGNING_CERT_SHA256|ZERO_VAULT_ANDROID_VERSION_CODE|\
    EXPO_PUBLIC_ZERO_VAULT_API_URL|ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON) ;;
    *) fail "release.env contains an unexpected key" ;;
  esac
  [[ -z "${release[$key]+x}" ]] || fail "release.env contains a duplicate key"
  [[ -n "$value" ]] || fail "release.env contains an empty value"
  release["$key"]="$value"
done <"$RELEASE_ENV"

for key in "${EXPECTED_KEYS[@]}"; do
  [[ -n "${release[$key]+x}" ]] || fail "release.env is missing a required key"
done
(( ${#release[@]} == ${#EXPECTED_KEYS[@]} )) ||
  fail "release.env must contain exactly the fixed release key set"

[[ "${release[ZERO_VAULT_ANDROID_STORE_FILE]}" == "$CONTAINER_STORE_FILE" ]] ||
  fail "release.env contains an unexpected keystore path"
(( ${#release[ZERO_VAULT_ANDROID_STORE_PASSWORD]} >= 12 &&
   ${#release[ZERO_VAULT_ANDROID_STORE_PASSWORD]} <= 1024 )) ||
  fail "Store password length is outside the accepted range"
(( ${#release[ZERO_VAULT_ANDROID_KEY_PASSWORD]} >= 12 &&
   ${#release[ZERO_VAULT_ANDROID_KEY_PASSWORD]} <= 1024 )) ||
  fail "Key password length is outside the accepted range"
[[ "${release[ZERO_VAULT_ANDROID_KEY_ALIAS]}" =~ ^[A-Za-z0-9._-]{3,128}$ ]] ||
  fail "Key alias has an invalid format"
case "${release[ZERO_VAULT_ANDROID_STORE_PASSWORD],,}" in
  android|password|changeit) fail "Refusing a placeholder store password" ;;
esac
case "${release[ZERO_VAULT_ANDROID_KEY_PASSWORD],,}" in
  android|password|changeit) fail "Refusing a placeholder key password" ;;
esac
case "${release[ZERO_VAULT_ANDROID_VERSION_CODE]}" in
  *[!0-9]*|'') fail "versionCode must be a positive integer" ;;
esac
version_code="${release[ZERO_VAULT_ANDROID_VERSION_CODE]}"
(( version_code > 1 && version_code <= 2100000000 )) ||
  fail "versionCode is outside the accepted range"

expected_cert="$(
  printf '%s' "${release[ZERO_VAULT_ANDROID_SIGNING_CERT_SHA256]}" |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
[[ "$expected_cert" =~ ^[0-9A-F]{64}$ &&
   "$expected_cert" != 0000000000000000000000000000000000000000000000000000000000000000 ]] ||
  fail "Expected signing certificate SHA-256 is invalid"

api_url="${release[EXPO_PUBLIC_ZERO_VAULT_API_URL]}"
(( ${#api_url} <= 2048 )) || fail "Production API URL is too long"
api_host="$(
  printf '%s' "$api_url" |
    docker exec -i "$CONTAINER" node -e '
      const fs = require("node:fs");
      const raw = fs.readFileSync(0, "utf8");
      try {
        if (!raw || raw.trim() !== raw || raw.includes("?") || raw.includes("#")) throw 0;
        const url = new URL(raw);
        if (url.protocol !== "https:" || url.username || url.password ||
            url.search || url.hash || !url.hostname || url.port === "0") throw 0;
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (host === "localhost" || host === "::1" || host === "0.0.0.0" ||
            /^127(?:\.[0-9]{1,3}){3}$/.test(host) ||
            /(^|\.)example(\.|$)/.test(host) ||
            /\.(invalid|test|localhost)$/.test(host)) throw 0;
        process.stdout.write(url.hostname);
      } catch {
        process.exit(1);
      }
    '
)" || fail "Production API URL failed strict HTTPS validation"
[[ -n "$api_host" ]] || fail "Production API URL has no hostname"

allowlist="${release[ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON]}"
(( ${#allowlist} <= 65535 )) || fail "Privileged caller allowlist is too large"
canonical_allowlist="$(
  printf '%s' "$allowlist" |
    docker exec -i "$CONTAINER" jq -ceS '
      . as $allowlist |
      (
        (keys == ["apps"]) and
        (.apps | type == "array" and length > 0) and
        all(.apps[];
          ((keys | sort) == ["info", "type"]) and
          .type == "android" and
          (.info | type == "object") and
          ((.info | keys | sort) == ["package_name", "signatures"]) and
          (.info.package_name | type == "string") and
          (.info.package_name | test("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$")) and
          (.info.package_name | test("(^|\\.)example(\\.|$)") | not) and
          (.info.signatures | type == "array" and length > 0) and
          all(.info.signatures[];
            ((keys | sort) == ["build", "cert_fingerprint_sha256"]) and
            .build == "release" and
            (.cert_fingerprint_sha256 | type == "string") and
            ((.cert_fingerprint_sha256 | gsub(":"; "")) as $cert |
              ($cert | test("^[0-9A-Fa-f]{64}$")) and
              $cert != "0000000000000000000000000000000000000000000000000000000000000000")
          )
        )
      ) as $valid |
      if $valid then $allowlist else error("invalid privileged caller allowlist") end
    '
)" || fail "Privileged caller allowlist failed strict production validation"
embedded_allowlist="$(
  printf '%s' "$canonical_allowlist" |
    docker exec -i "$CONTAINER" jq -ceS '
      {
        apps: [
          .apps[] |
          {
            type,
            info: {
              package_name: .info.package_name,
              signatures: [
                .info.signatures[] |
                {
                  build,
                  cert_fingerprint_sha256: (
                    .cert_fingerprint_sha256 |
                    gsub(":"; "") |
                    ascii_upcase |
                    [scan("..")] |
                    join(":")
                  )
                }
              ]
            }
          }
        ]
      }
    '
)" || fail "Unable to derive the Android-embedded privileged caller allowlist"
embedded_allowlist_sha256="$(
  printf '%s' "$embedded_allowlist" | sha256sum | awk '{print $1}'
)"
[[ "$embedded_allowlist_sha256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Unable to calculate the embedded privileged caller allowlist digest"
api_url_sha256="$(printf '%s' "$api_url" | sha256sum | awk '{print $1}')"
[[ "$api_url_sha256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Unable to calculate the API URL digest"

printf '%s\n' \
  "apiHost=$api_host" \
  "apiUrlSha256=$api_url_sha256" \
  >"$ARTIFACT_DIR/api-endpoint.txt"
printf '%s\n' "$embedded_allowlist_sha256  -" >"$ARTIFACT_DIR/privileged-callers-SHA256"
release_env_sha256="$(sha256sum "$RELEASE_ENV" | awk '{print $1}')"
[[ "$release_env_sha256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Unable to calculate release.env digest"

readonly STAGING_DIR="$PRIVATE_RELEASE_ROOT/$run_id"
[[ ! -e "$STAGING_DIR" ]] || fail "Personal release staging directory already exists"
mkdir -m 700 "$STAGING_DIR"
trap 'rm -rf "$STAGING_DIR"' EXIT

# Dependency lifecycle scripts run before any release configuration is passed
# to the build process. The development container has no signing material.
docker exec "$CONTAINER" bash -lc \
  'cd /workspace && env -u NODE_ENV pnpm install --frozen-lockfile --prefer-offline'

docker exec \
  -e CI=1 \
  -e NODE_ENV=production \
  -e "ZERO_VAULT_ANDROID_VERSION_CODE=${release[ZERO_VAULT_ANDROID_VERSION_CODE]}" \
  -e "EXPO_PUBLIC_ZERO_VAULT_API_URL=$api_url" \
  -e "ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON=$canonical_allowlist" \
  -i "$CONTAINER" bash -s -- "$CONTAINER_ARTIFACT_DIR" <<'BUILD'
set -euo pipefail
artifact_dir="$1"
cd /workspace/apps/mobile
pnpm exec expo prebuild --platform android --clean
cd android
if grep -Eq 'ZERO_VAULT_ANDROID_(STORE_FILE|STORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD|SIGNING_CERT_SHA256)' \
  app/build.gradle; then
  echo "Generated Gradle file contains a signing secret input" >&2
  exit 1
fi
./gradlew assembleRelease
mapfile -d '' release_apks < <(
  find app/build/outputs/apk/release -maxdepth 1 -type f -name '*.apk' -print0
)
test "${#release_apks[@]}" -eq 1
test "$(basename "${release_apks[0]}")" = app-release-unsigned.apk
if "$ANDROID_HOME/build-tools/36.0.0/apksigner" verify "${release_apks[0]}" \
  >/dev/null 2>&1; then
  echo "Gradle release output is unexpectedly signed" >&2
  exit 1
fi
test -s app/build/outputs/mapping/release/mapping.txt
cp app/build/outputs/mapping/release/mapping.txt "$artifact_dir/mapping.txt"
native_symbols="$(
  find app/build/outputs/native-debug-symbols -type f -name '*.zip' -print -quit
)"
test -n "$native_symbols" && test -s "$native_symbols"
cp "$native_symbols" "$artifact_dir/native-debug-symbols.zip"
cd /workspace
ARTIFACT_DIR="$artifact_dir" bash scripts/mobile-create-sbom.sh release
BUILD

docker cp \
  "$CONTAINER:/workspace/apps/mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk" \
  "$STAGING_DIR/app-release-unsigned.apk"
docker exec "$CONTAINER" rm -f \
  /workspace/apps/mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk
chmod 0600 "$STAGING_DIR/app-release-unsigned.apk"
[[ -s "$STAGING_DIR/app-release-unsigned.apk" ]] ||
  fail "Unsigned APK was not produced by the isolated build"
sha256sum "$STAGING_DIR/app-release-unsigned.apk" >"$ARTIFACT_DIR/unsigned-apk-SHA256"
mkdir -m 700 "$STAGING_DIR/signing-output"
readonly SIGNER_ENV="$STAGING_DIR/signer.env"
printf '%s\n' \
  "ZERO_VAULT_ANDROID_STORE_PASSWORD=${release[ZERO_VAULT_ANDROID_STORE_PASSWORD]}" \
  "ZERO_VAULT_ANDROID_KEY_ALIAS=${release[ZERO_VAULT_ANDROID_KEY_ALIAS]}" \
  "ZERO_VAULT_ANDROID_KEY_PASSWORD=${release[ZERO_VAULT_ANDROID_KEY_PASSWORD]}" \
  "ZERO_VAULT_ANDROID_SIGNING_CERT_SHA256=$expected_cert" \
  "ZERO_VAULT_ANDROID_VERSION_CODE=${release[ZERO_VAULT_ANDROID_VERSION_CODE]}" \
  "ZERO_VAULT_RELEASE_ENV_SHA256=$release_env_sha256" \
  >"$SIGNER_ENV"
chmod 0600 "$SIGNER_ENV"
image_id="$(docker inspect --format '{{.Image}}' "$CONTAINER")"
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] ||
  fail "Unable to resolve the pinned Android tool image"
printf '%s\n' "$image_id" >"$ARTIFACT_DIR/signing-image-id.txt"

docker run \
  --rm \
  -i \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 128 \
  --memory 2g \
  --cpus 2 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  --mount "type=bind,src=$STAGING_DIR/app-release-unsigned.apk,dst=/input/app-release-unsigned.apk,readonly" \
  --mount "type=bind,src=$RELEASE_KEYSTORE,dst=$CONTAINER_STORE_FILE,readonly" \
  --mount "type=bind,src=$STAGING_DIR/signing-output,dst=/output" \
  --env-file "$SIGNER_ENV" \
  -e HOME=/tmp/home \
  -e TMPDIR=/tmp \
  --entrypoint bash \
  "$image_id" \
  -s -- /input/app-release-unsigned.apk /output \
  <"$SOURCE_ROOT/scripts/mobile-sign-personal.sh"

readonly SIGNING_OUTPUT="$STAGING_DIR/signing-output"
for file in \
  zero-vault-personal-release.apk \
  artifact-SHA256SUMS \
  apk-signature.txt \
  sign-operation.txt \
  zipalign-16k.txt \
  version.txt \
  signing-cert.txt \
  manifest-permissions.txt \
  elf-16k.txt \
  sensitive-string-findings.txt; do
  [[ -f "$SIGNING_OUTPUT/$file" && ! -L "$SIGNING_OUTPUT/$file" &&
     -s "$SIGNING_OUTPUT/$file" ]] ||
    fail "Isolated signer did not produce required evidence"
  install -m 0644 "$SIGNING_OUTPUT/$file" "$ARTIFACT_DIR/$file"
done

(
  cd "$ARTIFACT_DIR"
  sha256sum -c artifact-SHA256SUMS
  grep -qx clean sensitive-string-findings.txt
  app_version="$(docker exec "$CONTAINER" node -p \
    "require('/workspace/apps/mobile/app.json').expo.version")"
  package_version="$(docker exec "$CONTAINER" node -p \
    "require('/workspace/apps/mobile/package.json').version")"
  apk_version="$(sed -n 's/^versionName=//p' version.txt)"
  sbom_version="$(docker exec "$CONTAINER" node -p \
    "require('$CONTAINER_ARTIFACT_DIR/sbom/zero-vault-mobile.cdx.json').metadata.component.version")"
  [[ -n "$app_version" && "$app_version" == "$package_version" &&
     "$app_version" == "$apk_version" && "$app_version" == "$sbom_version" ]] ||
    fail "app.json, package.json, APK and SBOM versions must match"
)

final_apk_sha256="$(sha256sum "$ARTIFACT_DIR/zero-vault-personal-release.apk" | awk '{print $1}')"
[[ "$final_apk_sha256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Unable to calculate final APK digest"
mkdir -m 700 "$STAGING_DIR/verifier-output"
docker run \
  --rm \
  -i \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 64 \
  --memory 1g \
  --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m \
  --mount "type=bind,src=$ARTIFACT_DIR/zero-vault-personal-release.apk,dst=/input/final.apk,readonly" \
  --mount "type=bind,src=$STAGING_DIR/verifier-output,dst=/output" \
  -e "EXPECTED_CERT_SHA256=$expected_cert" \
  -e "EXPECTED_APK_SHA256=$final_apk_sha256" \
  -e "EXPECTED_API_URL=$api_url" \
  -e "EXPECTED_API_URL_SHA256=$api_url_sha256" \
  -e "EXPECTED_ALLOWLIST_SHA256=$embedded_allowlist_sha256" \
  --entrypoint bash \
  "$image_id" \
  -s <<'VERIFY'
set -euo pipefail
apk=/input/final.apk
report=/output/final-verification.txt
apksigner="${ANDROID_HOME:?}/build-tools/36.0.0/apksigner"
actual_apk_sha256="$(sha256sum "$apk" | awk '{print $1}')"
test "$actual_apk_sha256" = "$EXPECTED_APK_SHA256"
"$apksigner" verify --verbose --print-certs "$apk" >"$report"
grep -Fqx 'Verified using v2 scheme (APK Signature Scheme v2): true' "$report"
test "$(
  grep -Ec '^Signer #[0-9]+ certificate SHA-256 digest: [0-9A-Fa-f]{64}$' "$report"
)" = 1
actual_cert="$(
  sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$report" |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
test "$actual_cert" = "$EXPECTED_CERT_SHA256"

mapfile -t bundle_entries < <(unzip -Z1 "$apk" | grep -Fx 'assets/index.android.bundle')
test "${#bundle_entries[@]}" = 1
apk_api_occurrences="$(
  unzip -p "$apk" |
    grep -aFo "$EXPECTED_API_URL" |
    wc -l |
    tr -d ' '
)"
test "$apk_api_occurrences" = 1
actual_api_url_sha256="$(printf '%s' "$EXPECTED_API_URL" | sha256sum | awk '{print $1}')"
test "$actual_api_url_sha256" = "$EXPECTED_API_URL_SHA256"

allowlist_matches=0
allowlist_resource=""
while IFS= read -r resource; do
  embedded_json="$(unzip -p "$apk" "$resource" | jq -ceS . 2>/dev/null || true)"
  [[ -n "$embedded_json" ]] || continue
  embedded_sha256="$(printf '%s' "$embedded_json" | sha256sum | awk '{print $1}')"
  if [[ "$embedded_sha256" == "$EXPECTED_ALLOWLIST_SHA256" ]]; then
    allowlist_matches=$((allowlist_matches + 1))
    allowlist_resource="$resource"
  fi
done < <(unzip -Z1 "$apk" | grep -E '^res/[^/]+\.json$' || true)
test "$allowlist_matches" = 1

printf '%s\n' \
  "APK SHA-256: $actual_apk_sha256" \
  "APK API URL occurrences: $apk_api_occurrences" \
  "Embedded API URL SHA-256: $actual_api_url_sha256" \
  "Embedded privileged caller resource: $allowlist_resource" \
  "Embedded privileged caller SHA-256: $EXPECTED_ALLOWLIST_SHA256" \
  'Final isolated verification: passed' \
  >>"$report"
VERIFY
[[ -s "$STAGING_DIR/verifier-output/final-verification.txt" ]] ||
  fail "Final isolated APK verification did not produce evidence"
install -m 0644 \
  "$STAGING_DIR/verifier-output/final-verification.txt" \
  "$ARTIFACT_DIR/final-verification.txt"

printf '%s\n' \
  'Install: copy zero-vault-personal-release.apk to the device, open it in the system file manager, allow this source when prompted, and confirm installation.' \
  'Update: repeat with a higher-version APK signed by the same keystore; Android preserves app data during the in-place update.' \
  'Verify artifact-SHA256SUMS before transfer and keep the signing keystore plus release.env in a secure offline backup.' \
  'adb is optional and must not be installed or run on the local development machine.' \
  >"$ARTIFACT_DIR/INSTALL.txt"
chmod 0644 "$ARTIFACT_DIR/INSTALL.txt"

docker exec -i "$CONTAINER" bash -s -- \
  "$CONTAINER_ARTIFACT_DIR/zero-vault-personal-release.apk" \
  "$CONTAINER_ARTIFACT_DIR" <<'INSTALL'
set -euo pipefail
release_apk="$1"
artifact_dir="$2"
timeout 240 adb wait-for-device
timeout 240 bash -c 'until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" = 1 ]; do sleep 2; done'
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 36
adb install -r "$release_apk" | tee "$artifact_dir/release-install.txt"
grep -q '^Success' "$artifact_dir/release-install.txt"
activity="$(
  adb shell cmd package resolve-activity --brief \
    -a android.intent.action.MAIN \
    -c android.intent.category.LAUNCHER \
    com.zerovault.mobile |
    tr -d '\r' |
    tail -1
)"
case "$activity" in
  com.zerovault.mobile/*) ;;
  *) echo "Release launcher activity was not resolved" >&2; exit 1 ;;
esac
adb shell am start -W -n "$activity" | tee "$artifact_dir/release-start.txt"
grep -q '^Status: ok' "$artifact_dir/release-start.txt"
timeout 30 bash -c 'until adb shell pidof com.zerovault.mobile >/dev/null; do sleep 1; done'
adb shell pidof com.zerovault.mobile | tee "$artifact_dir/release-pid.txt"
INSTALL

printf '%s\n' personal-release-complete
