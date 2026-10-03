#!/usr/bin/env bash
set -euo pipefail

umask 077

readonly SOURCE_ROOT=/root/dev/zero-vault
readonly ARTIFACTS_ROOT=/root/dev/zero-vault-artifacts
readonly SECRETS_DIR=/root/dev/zero-vault-play-secrets
readonly RELEASE_ENV="$SECRETS_DIR/release.env"
readonly RELEASE_KEYSTORE="$SECRETS_DIR/upload.keystore"
readonly PERSONAL_SECRETS_DIR=/root/dev/zero-vault-android-secrets
readonly PERSONAL_RELEASE_ENV="$PERSONAL_SECRETS_DIR/release.env"
readonly PERSONAL_RELEASE_KEYSTORE="$PERSONAL_SECRETS_DIR/release.keystore"
readonly PRIVATE_RELEASE_ROOT=/root/.zero-vault-android-play-release
readonly CONTAINER=zero-vault-android-dev
readonly EXPECTED_IMAGE=zero-vault/android-dev:sdk57
readonly CONTAINER_STORE_FILE=/run/zero-vault-play-secrets/upload.keystore
readonly BUNDLETOOL_SHA256=a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29
readonly ARTIFACT_DIR="${ARTIFACT_DIR:?ARTIFACT_DIR is required}"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

validate_private_file() {
  local file="$1"
  local label="$2"
  [[ -f "$file" && ! -L "$file" ]] ||
    fail "$label must be a regular non-symlink file"
  [[ "$(stat -c '%F' "$file")" == "regular file" ]] ||
    fail "$label must be a regular file"
  [[ "$(stat -c '%u' "$file")" == 0 ]] || fail "$label must be owned by root"
  case "$(stat -c '%a' "$file")" in
    400|600) ;;
    *) fail "$label must have mode 400 or 600" ;;
  esac
  [[ "$(stat -c '%h' "$file")" == 1 ]] ||
    fail "$label must not have hard links"
  [[ -s "$file" ]] || fail "$label must not be empty"
}

canonical_artifact_dir="$(readlink -f "$ARTIFACT_DIR")"
run_id="${canonical_artifact_dir#"$ARTIFACTS_ROOT"/}"
[[ "$canonical_artifact_dir" == "$ARTIFACTS_ROOT/$run_id" &&
   "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z-play-aab-[0-9]+-[0-9]+$ ]] ||
  fail "ARTIFACT_DIR is outside the dedicated play-aab run directory"
[[ -d "$canonical_artifact_dir" && ! -L "$ARTIFACT_DIR" ]] ||
  fail "ARTIFACT_DIR is missing or invalid"
readonly CONTAINER_ARTIFACT_DIR="/artifacts/$run_id"

[[ -d "$SECRETS_DIR" && ! -L "$SECRETS_DIR" ]] ||
  fail "Play secrets directory is missing or invalid"
[[ "$(stat -c '%u' "$SECRETS_DIR")" == 0 ]] ||
  fail "Play secrets directory must be owned by root"
[[ "$(stat -c '%a' "$SECRETS_DIR")" == 700 ]] ||
  fail "Play secrets directory must have mode 700"
validate_private_file "$RELEASE_ENV" "Play release.env"
validate_private_file "$RELEASE_KEYSTORE" "Play upload.keystore"

[[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" == true ]] ||
  fail "Android development container is not running"
[[ "$(docker inspect --format '{{.Config.Image}}' "$CONTAINER")" == "$EXPECTED_IMAGE" ]] ||
  fail "Android development container uses an unexpected image tag"
if docker inspect --format '{{range .Mounts}}{{println .Source "|" .Destination}}{{end}}' \
  "$CONTAINER" |
  grep -Eq 'zero-vault-(android|play)-secrets|/run/zero-vault-(secrets|play-secrets)'; then
  fail "Development container still has a signing secrets mount; recreate it before release"
fi
if docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" |
  grep -Eq '^ZERO_VAULT_ANDROID_(PLAY_)?(STORE_FILE|STORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD|SIGNING_CERT_SHA256|UPLOAD_CERT_SHA256)='; then
  fail "Development container has persistent Android signing environment variables"
fi
docker exec "$CONTAINER" bash -lc \
  "test \"\$(bundletool version)\" = 1.18.3 &&
   echo '$BUNDLETOOL_SHA256  /opt/bundletool/bundletool.jar' | sha256sum -c - >/dev/null" ||
  fail "Development container does not contain the pinned bundletool"
image_id="$(docker inspect --format '{{.Image}}' "$CONTAINER")"
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] ||
  fail "Unable to resolve the pinned Android tool image"
source_signer_sha256="$(sha256sum "$SOURCE_ROOT/scripts/mobile-sign-play-aab.sh" | awk '{print $1}')"
image_signer_sha256="$(
  docker run \
    --rm \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --pids-limit 16 \
    --memory 128m \
    --cpus 1 \
    --entrypoint sha256sum \
    "$image_id" \
    /opt/zero-vault-release/mobile-sign-play-aab.sh |
    awk '{print $1}'
)"
[[ "$source_signer_sha256" =~ ^[0-9a-f]{64}$ &&
   "$image_signer_sha256" == "$source_signer_sha256" ]] ||
  fail "Pinned Play signer does not match this synchronized source; rebuild the Android image"

mkdir -p -m 700 "$PRIVATE_RELEASE_ROOT"
[[ -d "$PRIVATE_RELEASE_ROOT" && ! -L "$PRIVATE_RELEASE_ROOT" &&
   "$(stat -c '%u' "$PRIVATE_RELEASE_ROOT")" == 0 &&
   "$(stat -c '%a' "$PRIVATE_RELEASE_ROOT")" == 700 ]] ||
  fail "Private Play release staging root must be a root-owned mode-700 directory"
while IFS= read -r mount_source; do
  [[ -n "$mount_source" ]] || continue
  mount_source="$(readlink -f "$mount_source")"
  [[ "$mount_source" != / ]] ||
    fail "Development container can see the private Play release staging root"
  case "$PRIVATE_RELEASE_ROOT/" in
    "$mount_source/"*)
      fail "Development container can see the private Play release staging root"
      ;;
  esac
done < <(docker inspect --format '{{range .Mounts}}{{println .Source}}{{end}}' "$CONTAINER")

readonly EXPECTED_KEYS=(
  ZERO_VAULT_ANDROID_PLAY_STORE_FILE
  ZERO_VAULT_ANDROID_PLAY_STORE_TYPE
  ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD
  ZERO_VAULT_ANDROID_PLAY_KEY_ALIAS
  ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD
  ZERO_VAULT_ANDROID_PLAY_UPLOAD_CERT_SHA256
  ZERO_VAULT_ANDROID_VERSION_CODE
  EXPO_PUBLIC_ZERO_VAULT_API_URL
  ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON
)
declare -A release=()
line_number=0
while IFS= read -r line || [[ -n "$line" ]]; do
  line_number=$((line_number + 1))
  [[ "$line" != *$'\r'* ]] || fail "Play release.env contains a carriage return"
  [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] ||
    fail "Play release.env line $line_number is not a strict KEY=value entry"
  key="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  case "$key" in
    ZERO_VAULT_ANDROID_PLAY_STORE_FILE|\
    ZERO_VAULT_ANDROID_PLAY_STORE_TYPE|\
    ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD|\
    ZERO_VAULT_ANDROID_PLAY_KEY_ALIAS|\
    ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD|\
    ZERO_VAULT_ANDROID_PLAY_UPLOAD_CERT_SHA256|\
    ZERO_VAULT_ANDROID_VERSION_CODE|\
    EXPO_PUBLIC_ZERO_VAULT_API_URL|\
    ZERO_VAULT_ANDROID_PRIVILEGED_CALLERS_JSON) ;;
    *) fail "Play release.env contains an unexpected key" ;;
  esac
  [[ -z "${release[$key]+x}" ]] ||
    fail "Play release.env contains a duplicate key"
  [[ -n "$value" ]] || fail "Play release.env contains an empty value"
  release["$key"]="$value"
done <"$RELEASE_ENV"

for key in "${EXPECTED_KEYS[@]}"; do
  [[ -n "${release[$key]+x}" ]] ||
    fail "Play release.env is missing a required key"
done
(( ${#release[@]} == ${#EXPECTED_KEYS[@]} )) ||
  fail "Play release.env must contain exactly the fixed release key set"

[[ "${release[ZERO_VAULT_ANDROID_PLAY_STORE_FILE]}" == "$CONTAINER_STORE_FILE" ]] ||
  fail "Play release.env contains an unexpected keystore path"
case "${release[ZERO_VAULT_ANDROID_PLAY_STORE_TYPE]}" in
  JKS|PKCS12) ;;
  *) fail "Play keystore type must be JKS or PKCS12" ;;
esac
(( ${#release[ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD]} >= 12 &&
   ${#release[ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD]} <= 1024 )) ||
  fail "Play store password length is outside the accepted range"
(( ${#release[ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD]} >= 12 &&
   ${#release[ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD]} <= 1024 )) ||
  fail "Play key password length is outside the accepted range"
[[ "${release[ZERO_VAULT_ANDROID_PLAY_KEY_ALIAS]}" =~ ^[A-Za-z0-9._-]{3,128}$ ]] ||
  fail "Play key alias has an invalid format"
case "${release[ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD],,}" in
  android|password|changeit) fail "Refusing a placeholder Play store password" ;;
esac
case "${release[ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD],,}" in
  android|password|changeit) fail "Refusing a placeholder Play key password" ;;
esac
case "${release[ZERO_VAULT_ANDROID_VERSION_CODE]}" in
  *[!0-9]*|'') fail "versionCode must be a positive integer" ;;
esac
version_code="${release[ZERO_VAULT_ANDROID_VERSION_CODE]}"
(( version_code > 1 && version_code <= 2100000000 )) ||
  fail "versionCode is outside the accepted range"

expected_cert="$(
  printf '%s' "${release[ZERO_VAULT_ANDROID_PLAY_UPLOAD_CERT_SHA256]}" |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
[[ "$expected_cert" =~ ^[0-9A-F]{64}$ &&
   "$expected_cert" != 0000000000000000000000000000000000000000000000000000000000000000 ]] ||
  fail "Expected Play upload certificate SHA-256 is invalid"

personal_keystore_exists=false
personal_env_exists=false
[[ -e "$PERSONAL_RELEASE_KEYSTORE" ]] && personal_keystore_exists=true
[[ -e "$PERSONAL_RELEASE_ENV" ]] && personal_env_exists=true
[[ "$personal_keystore_exists" == true && "$personal_env_exists" == true ]] ||
  fail "Personal signing evidence is required to prove Play upload-key separation"
validate_private_file "$PERSONAL_RELEASE_KEYSTORE" "Personal release.keystore"
validate_private_file "$PERSONAL_RELEASE_ENV" "Personal release.env"
[[ "$(sha256sum "$RELEASE_KEYSTORE" | awk '{print $1}')" != \
   "$(sha256sum "$PERSONAL_RELEASE_KEYSTORE" | awk '{print $1}')" ]] ||
  fail "Play upload keystore must not reuse the personal APK keystore"
mapfile -t personal_cert_lines < <(
  sed -n 's/^ZERO_VAULT_ANDROID_SIGNING_CERT_SHA256=//p' "$PERSONAL_RELEASE_ENV"
)
mapfile -t personal_store_password_lines < <(
  sed -n 's/^ZERO_VAULT_ANDROID_STORE_PASSWORD=//p' "$PERSONAL_RELEASE_ENV"
)
mapfile -t personal_alias_lines < <(
  sed -n 's/^ZERO_VAULT_ANDROID_KEY_ALIAS=//p' "$PERSONAL_RELEASE_ENV"
)
(( ${#personal_cert_lines[@]} == 1 &&
   ${#personal_store_password_lines[@]} == 1 &&
   ${#personal_alias_lines[@]} == 1 )) ||
  fail "Personal signing evidence is invalid"
personal_cert="$(
  printf '%s' "${personal_cert_lines[0]}" |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
personal_store_password="${personal_store_password_lines[0]}"
personal_alias="${personal_alias_lines[0]}"
[[ "$personal_cert" =~ ^[0-9A-F]{64}$ &&
   ${#personal_store_password} -ge 12 &&
   "$personal_alias" =~ ^[A-Za-z0-9._-]{3,128}$ ]] ||
  fail "Personal signing evidence is invalid"
[[ "$expected_cert" != "$personal_cert" ]] ||
  fail "Play upload certificate must not reuse the personal APK signing key"

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
api_url_sha256="$(printf '%s' "$api_url" | sha256sum | awk '{print $1}')"
allowlist_sha256="$(printf '%s' "$embedded_allowlist" | sha256sum | awk '{print $1}')"
[[ "$api_url_sha256" =~ ^[0-9a-f]{64}$ &&
   "$allowlist_sha256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Unable to calculate production configuration digests"
printf '%s\n' \
  "apiHost=$api_host" \
  "apiUrlSha256=$api_url_sha256" \
  >"$ARTIFACT_DIR/api-endpoint.txt"
printf '%s\n' "$allowlist_sha256  -" \
  >"$ARTIFACT_DIR/privileged-callers-SHA256"

release_env_sha256="$(sha256sum "$RELEASE_ENV" | awk '{print $1}')"
[[ "$release_env_sha256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Unable to calculate Play release.env digest"

readonly STAGING_DIR="$PRIVATE_RELEASE_ROOT/$run_id"
[[ ! -e "$STAGING_DIR" ]] || fail "Play release staging directory already exists"
mkdir -m 700 "$STAGING_DIR"
trap 'rm -rf "$STAGING_DIR"' EXIT

printf '%s\n' "$image_id" >"$ARTIFACT_DIR/signing-image-id.txt"

readonly PERSONAL_CHECK_ENV="$STAGING_DIR/personal-check.env"
printf '%s\n' "PERSONAL_STORE_PASSWORD=$personal_store_password" \
  >"$PERSONAL_CHECK_ENV"
chmod 0600 "$PERSONAL_CHECK_ENV"
docker run \
  --rm \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 32 \
  --memory 512m \
  --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --mount "type=bind,src=$PERSONAL_RELEASE_KEYSTORE,dst=/input/personal.keystore,readonly" \
  --env-file "$PERSONAL_CHECK_ENV" \
  --entrypoint /usr/lib/jvm/java-17-openjdk-amd64/bin/keytool \
  "$image_id" \
  -list -v \
  -keystore /input/personal.keystore \
  -storepass:env PERSONAL_STORE_PASSWORD \
  -alias "$personal_alias" \
  >"$STAGING_DIR/personal-keytool.txt" 2>&1
rm -f "$PERSONAL_CHECK_ENV"
actual_personal_cert="$(
  sed -n 's/^[[:space:]]*SHA256: //p' "$STAGING_DIR/personal-keytool.txt" |
    head -1 |
    tr -cd '0-9A-Fa-f' |
    tr '[:lower:]' '[:upper:]'
)"
[[ "$actual_personal_cert" == "$personal_cert" ]] ||
  fail "Personal release.env certificate does not match its actual keystore"
[[ "$actual_personal_cert" != "$expected_cert" ]] ||
  fail "Play upload certificate must not reuse the actual personal APK signing key"
printf '%s\n' \
  "personalCertificateSHA256=$actual_personal_cert" \
  "playUploadCertificateSHA256=$expected_cert" \
  'separateKeys=true' \
  >"$ARTIFACT_DIR/signing-key-separation.txt"

# Dependency lifecycle scripts and Gradle run without any Play signing material.
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
if grep -Eq 'ZERO_VAULT_ANDROID_(PLAY_)?(STORE_FILE|STORE_PASSWORD|KEY_ALIAS|KEY_PASSWORD|SIGNING_CERT_SHA256|UPLOAD_CERT_SHA256)' \
  app/build.gradle; then
  echo "Generated Gradle file contains a signing secret input" >&2
  exit 1
fi
./gradlew bundleRelease
mapfile -d '' release_aabs < <(
  find app/build/outputs/bundle/release -maxdepth 1 -type f -name '*.aab' -print0
)
test "${#release_aabs[@]}" -eq 1
test "$(basename "${release_aabs[0]}")" = app-release.aab
if unzip -Z1 "${release_aabs[0]}" |
  grep -Eiq '^META-INF/[^/]+\.(SF|RSA|DSA|EC)$'; then
  echo "Gradle release AAB is unexpectedly signed" >&2
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
  "$CONTAINER:/workspace/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab" \
  "$STAGING_DIR/app-release-unsigned.aab"
docker exec "$CONTAINER" rm -f \
  /workspace/apps/mobile/android/app/build/outputs/bundle/release/app-release.aab
chmod 0600 "$STAGING_DIR/app-release-unsigned.aab"
[[ -s "$STAGING_DIR/app-release-unsigned.aab" ]] ||
  fail "Unsigned AAB was not produced by the isolated build"
unsigned_aab_sha256="$(
  sha256sum "$STAGING_DIR/app-release-unsigned.aab" | awk '{print $1}'
)"
[[ "$unsigned_aab_sha256" =~ ^[0-9a-f]{64}$ ]] ||
  fail "Unable to calculate unsigned AAB digest"
printf '%s\n' "sha256=$unsigned_aab_sha256" \
  >"$ARTIFACT_DIR/unsigned-aab-SHA256"

mkdir -m 700 "$STAGING_DIR/signing-output"
readonly SIGNER_ENV="$STAGING_DIR/signer.env"
printf '%s\n' \
  "ZERO_VAULT_ANDROID_PLAY_STORE_TYPE=${release[ZERO_VAULT_ANDROID_PLAY_STORE_TYPE]}" \
  "ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD=${release[ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD]}" \
  "ZERO_VAULT_ANDROID_PLAY_KEY_ALIAS=${release[ZERO_VAULT_ANDROID_PLAY_KEY_ALIAS]}" \
  "ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD=${release[ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD]}" \
  "ZERO_VAULT_ANDROID_PLAY_UPLOAD_CERT_SHA256=$expected_cert" \
  "ZERO_VAULT_ANDROID_VERSION_CODE=${release[ZERO_VAULT_ANDROID_VERSION_CODE]}" \
  "ZERO_VAULT_PLAY_RELEASE_ENV_SHA256=$release_env_sha256" \
  "ZERO_VAULT_EXPECTED_API_URL=$api_url" \
  "ZERO_VAULT_EXPECTED_API_URL_SHA256=$api_url_sha256" \
  "ZERO_VAULT_EXPECTED_ALLOWLIST_SHA256=$allowlist_sha256" \
  >"$SIGNER_ENV"
chmod 0600 "$SIGNER_ENV"

docker run \
  --rm \
  -i \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 128 \
  --memory 3g \
  --cpus 2 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=1g \
  --mount "type=bind,src=$STAGING_DIR/app-release-unsigned.aab,dst=/input/app-release-unsigned.aab,readonly" \
  --mount "type=bind,src=$RELEASE_KEYSTORE,dst=$CONTAINER_STORE_FILE,readonly" \
  --mount "type=bind,src=$STAGING_DIR/signing-output,dst=/output" \
  --env-file "$SIGNER_ENV" \
  -e HOME=/tmp/home \
  -e TMPDIR=/tmp \
  --entrypoint /opt/zero-vault-release/mobile-sign-play-aab.sh \
  "$image_id" \
  /input/app-release-unsigned.aab /output

readonly SIGNING_OUTPUT="$STAGING_DIR/signing-output"
readonly SIGNING_FILES=(
  zero-vault-play-release.aab \
  aab-SHA256SUMS \
  aab-signature.txt \
  aab-certificate.txt \
  sign-operation.txt \
  bundletool-validate.txt \
  bundletool-build-apks.txt \
  bundletool-version.txt \
  universal-apk-signature.txt \
  universal-zipalign-16k.txt \
  final-verification.txt \
  manifest.xml \
  manifest-permissions.txt \
  version.txt \
  signing-cert.txt \
  elf-16k.txt \
  sensitive-string-findings.txt
)
mapfile -t actual_signing_files < <(
  find "$SIGNING_OUTPUT" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' |
    sort
)
mapfile -t expected_signing_files < <(printf '%s\n' "${SIGNING_FILES[@]}" | sort)
[[ "${actual_signing_files[*]}" == "${expected_signing_files[*]}" ]] ||
  fail "Isolated Play signer produced an unexpected output set"
if find "$SIGNING_OUTPUT" -mindepth 1 -maxdepth 1 ! -type f -print -quit |
  grep -q .; then
  fail "Isolated Play signer produced an unexpected non-file output"
fi
keystore_sha256="$(sha256sum "$RELEASE_KEYSTORE" | awk '{print $1}')"
for forbidden_value in \
  "${release[ZERO_VAULT_ANDROID_PLAY_STORE_PASSWORD]}" \
  "${release[ZERO_VAULT_ANDROID_PLAY_KEY_PASSWORD]}" \
  "$keystore_sha256"; do
  if grep -R -F -a -q -- "$forbidden_value" "$SIGNING_OUTPUT"; then
    fail "Isolated Play signer leaked signing material into its outputs"
  fi
done
for file in "${SIGNING_FILES[@]}"; do
  [[ -f "$SIGNING_OUTPUT/$file" && ! -L "$SIGNING_OUTPUT/$file" &&
     -s "$SIGNING_OUTPUT/$file" ]] ||
    fail "Isolated Play signer did not produce required evidence"
  install -m 0644 "$SIGNING_OUTPUT/$file" "$ARTIFACT_DIR/$file"
done

for file in \
  mapping.txt \
  native-debug-symbols.zip \
  sbom/zero-vault-mobile.cdx.json \
  sbom/pnpm-lock.yaml \
  sbom/pnpm-production-licenses.json \
  sbom/cargo-metadata.json \
  sbom/gradle-dependencies.txt \
  sbom/SHA256SUMS; do
  [[ -f "$ARTIFACT_DIR/$file" && ! -L "$ARTIFACT_DIR/$file" &&
     -s "$ARTIFACT_DIR/$file" ]] ||
    fail "Play build did not produce required release evidence"
done

printf '%s\n' \
  'Upload zero-vault-play-release.aab to the matching Google Play Console application.' \
  'Retain mapping.txt and native-debug-symbols.zip for the exact versionCode before upload.' \
  'Verify artifact-SHA256SUMS and signing-cert.txt before transferring release files.' \
  'This AAB is signed by the separate Play upload key; Google Play App Signing owns the distribution signing key.' \
  >"$ARTIFACT_DIR/UPLOAD.txt"
chmod 0644 "$ARTIFACT_DIR/UPLOAD.txt"

(
  cd "$ARTIFACT_DIR"
  sha256sum -c aab-SHA256SUMS
  grep -qx clean sensitive-string-findings.txt
  sha256sum \
    zero-vault-play-release.aab \
    aab-SHA256SUMS \
    aab-signature.txt \
    aab-certificate.txt \
    sign-operation.txt \
    bundletool-validate.txt \
    bundletool-build-apks.txt \
    bundletool-version.txt \
    universal-apk-signature.txt \
    universal-zipalign-16k.txt \
    final-verification.txt \
    manifest.xml \
    manifest-permissions.txt \
    version.txt \
    signing-cert.txt \
    elf-16k.txt \
    sensitive-string-findings.txt \
    mapping.txt \
    native-debug-symbols.zip \
    api-endpoint.txt \
    privileged-callers-SHA256 \
    signing-image-id.txt \
    signing-key-separation.txt \
    unsigned-aab-SHA256 \
    UPLOAD.txt \
    sbom/zero-vault-mobile.cdx.json \
    sbom/pnpm-lock.yaml \
    sbom/pnpm-production-licenses.json \
    sbom/cargo-metadata.json \
    sbom/gradle-dependencies.txt \
    sbom/SHA256SUMS \
    >artifact-SHA256SUMS
  sha256sum -c artifact-SHA256SUMS
)

printf '%s\n' play-aab-complete
