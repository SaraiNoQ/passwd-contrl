#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="root@campus-server"
REMOTE_SOURCE="/root/dev/zero-vault"
REMOTE_ARTIFACTS="/root/dev/zero-vault-artifacts"
REMOTE_LOCK="/root/dev/zero-vault-android.lock"
CONTAINER="zero-vault-android-dev"
SYNC="$ROOT/scripts/mobile-remote-sync.sh"
FINGERPRINT="$ROOT/scripts/mobile-source-fingerprint.sh"

usage() {
  echo "usage: $0 {build-debug|install-debug|build-release|install-release|artifacts <run-id>}"
}

inside_container() {
  local variant="$1"
  local install="$2"
  : "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"

  if [[ "$variant" == release ]]; then
    local secret_env=/run/zero-vault-secrets/autofill-fixture.env
    test -f "$secret_env"
    case "$(stat -c '%a' "$secret_env")" in 400|600) ;; *) echo "Unsafe fixture release env permissions" >&2; exit 1 ;; esac
    set -a
    # shellcheck disable=SC1090
    . "$secret_env"
    set +a
    : "${ZERO_VAULT_AUTOFILL_FIXTURE_STORE_FILE:?Missing fixture release keystore}"
    : "${ZERO_VAULT_AUTOFILL_FIXTURE_STORE_PASSWORD:?Missing fixture store password}"
    : "${ZERO_VAULT_AUTOFILL_FIXTURE_KEY_ALIAS:?Missing fixture key alias}"
    : "${ZERO_VAULT_AUTOFILL_FIXTURE_KEY_PASSWORD:?Missing fixture key password}"
    : "${ZERO_VAULT_AUTOFILL_FIXTURE_SIGNING_CERT_SHA256:?Missing expected fixture certificate}"
    case "$ZERO_VAULT_AUTOFILL_FIXTURE_STORE_FILE" in /run/zero-vault-secrets/*) ;; *) echo "Fixture keystore must be in the read-only secrets mount" >&2; exit 1 ;; esac
    test -f "$ZERO_VAULT_AUTOFILL_FIXTURE_STORE_FILE"
    case "$(stat -c '%a' "$ZERO_VAULT_AUTOFILL_FIXTURE_STORE_FILE")" in 400|600) ;; *) echo "Unsafe fixture keystore permissions" >&2; exit 1 ;; esac
  fi

  export CI=1
  if [[ ! -x /workspace/apps/mobile/node_modules/.bin/expo ]]; then
    (cd /workspace && env -u NODE_ENV pnpm install --frozen-lockfile --prefer-offline)
  fi
  cd /workspace/apps/mobile
  pnpm exec expo prebuild --platform android --clean
  printf '%s\n' \
    "include ':zero-vault-autofill-fixture'" \
    "project(':zero-vault-autofill-fixture').projectDir = new File(rootDir, '../../../infra/android/autofill-fixture')" \
    >> android/settings.gradle

  local task output_dir apk artifact_apk expected_debuggable
  if [[ "$variant" == debug ]]; then
    task=assembleDebug
    output_dir=/workspace/infra/android/autofill-fixture/build/outputs/apk/debug
    artifact_apk="$ARTIFACT_DIR/zero-vault-autofill-fixture-debug.apk"
    expected_debuggable=true
  else
    task=assembleRelease
    output_dir=/workspace/infra/android/autofill-fixture/build/outputs/apk/release
    artifact_apk="$ARTIFACT_DIR/zero-vault-autofill-fixture-release.apk"
    expected_debuggable=false
  fi

  cd android
  ./gradlew :zero-vault-autofill-fixture:clean ":zero-vault-autofill-fixture:$task"
  mapfile -t apks < <(find "$output_dir" -maxdepth 1 -type f -name '*.apk' -print)
  test "${#apks[@]}" = 1
  apk="${apks[0]}"
  test -s "$apk"
  "$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$apk" \
    | tee "$ARTIFACT_DIR/apk-signature.txt"
  test "$(apkanalyzer manifest application-id "$apk")" = com.zerovault.autofillfixture
  test "$(apkanalyzer manifest min-sdk "$apk")" = 26
  test "$(apkanalyzer manifest target-sdk "$apk")" = 36
  test "$(apkanalyzer manifest debuggable "$apk")" = "$expected_debuggable"

  local actual_cert expected_cert
  actual_cert="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$ARTIFACT_DIR/apk-signature.txt" \
    | head -1 | tr -cd '0-9A-Fa-f' | tr '[:lower:]' '[:upper:]')"
  [[ "$actual_cert" =~ ^[0-9A-F]{64}$ ]]
  if [[ "$variant" == release ]]; then
    expected_cert="$(printf '%s' "$ZERO_VAULT_AUTOFILL_FIXTURE_SIGNING_CERT_SHA256" \
      | tr -cd '0-9A-Fa-f' | tr '[:lower:]' '[:upper:]')"
    [[ "$expected_cert" =~ ^[0-9A-F]{64}$ ]]
    test "$actual_cert" = "$expected_cert"
  fi

  cp "$apk" "$artifact_apk"
  printf '%s\n' "SHA256=$actual_cert" > "$ARTIFACT_DIR/signing-cert.txt"
  jq -n --arg certificate "$actual_cert" \
    '{packageName:"com.zerovault.autofillfixture",signingCertificateSha256:$certificate}' \
    > "$ARTIFACT_DIR/android-association.json"
  printf '%s\n' \
    'applicationId=com.zerovault.autofillfixture' \
    'versionName=1.0.0' \
    'versionCode=1' \
    'minSdk=26' \
    'targetSdk=36' \
    "variant=$variant" \
    > "$ARTIFACT_DIR/version.txt"
  (cd "$ARTIFACT_DIR" && sha256sum "$(basename "$artifact_apk")" > artifact-SHA256SUMS)

  if [[ "$install" == true ]]; then
    timeout 240 adb wait-for-device
    timeout 240 bash -c 'until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" = 1 ]; do sleep 2; done'
    test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 36
    adb install -r "$apk" | tee "$ARTIFACT_DIR/install.txt"
    grep -q '^Success' "$ARTIFACT_DIR/install.txt"
    adb shell am start -W -n com.zerovault.autofillfixture/.MainActivity | tee "$ARTIFACT_DIR/start.txt"
    grep -q '^Status: ok' "$ARTIFACT_DIR/start.txt"
    maestro test \
      --format junit \
      --output "$ARTIFACT_DIR/surface-smoke-junit.xml" \
      /workspace/infra/android/autofill-fixture/surface-smoke.yml
    test -s "$ARTIFACT_DIR/surface-smoke-junit.xml"
  fi
}

if [[ "${1:-}" == --inside ]]; then
  inside_container "${2:?variant}" "${3:?install}"
  exit
fi

command="${1:-}"
if [[ "$command" == artifacts ]]; then
  run_id="${2:-}"
  if [[ ! "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z-autofill-fixture-(debug|release)-[0-9]+-[0-9]+$ ]]; then
    echo "artifacts requires an exact Autofill fixture run id" >&2
    exit 2
  fi
  remote_dir="$REMOTE_ARTIFACTS/$run_id"
  ssh "$REMOTE" "set -e; cd '$remote_dir'; grep -qx '0' exit-code.txt; grep -qx 'stale=false' stale.txt; sha256sum -c SHA256SUMS; sha256sum -c artifact-SHA256SUMS"
  local_dir="$ROOT/artifacts/mobile-remote/$run_id"
  mkdir -p "$local_dir"
  rsync -az "$REMOTE:$remote_dir/" "$local_dir/"
  (cd "$local_dir" && sha256sum -c SHA256SUMS && sha256sum -c artifact-SHA256SUMS)
  echo "Verified fixture artifacts: $local_dir"
  exit
fi

case "$command" in
  build-debug) variant=debug; install=false ;;
  install-debug) variant=debug; install=true ;;
  build-release) variant=release; install=false ;;
  install-release) variant=release; install=true ;;
  *) usage; exit 2 ;;
esac

lock_token="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM-$RANDOM"
release_lock() {
  ssh "$REMOTE" "if [ \"\$(cat '$REMOTE_LOCK/owner' 2>/dev/null)\" = '$lock_token' ]; then rm -f '$REMOTE_LOCK/owner' && rmdir '$REMOTE_LOCK'; fi" >/dev/null 2>&1 || true
}
ssh "$REMOTE" "mkdir '$REMOTE_LOCK' && printf '%s\n' '$lock_token' > '$REMOTE_LOCK/owner'" || {
  echo "Another Android sync/build owns $REMOTE_LOCK" >&2
  exit 1
}
trap release_lock EXIT INT TERM
export MOBILE_REMOTE_LOCK_TOKEN="$lock_token"
"$SYNC"

ssh "$REMOTE" "docker inspect '$CONTAINER' >/dev/null 2>&1"
run_id="$(date -u +%Y%m%dT%H%M%SZ)-autofill-fixture-$variant-$$-$RANDOM"
ssh "$REMOTE" "mkdir -p '$REMOTE_ARTIFACTS/$run_id' \
  && cp '$REMOTE_SOURCE/.remote-sync' '$REMOTE_ARTIFACTS/$run_id/sync.txt' \
  && docker ps --format '{{.Names}} {{.Status}}' > '$REMOTE_ARTIFACTS/$run_id/containers-before.txt'"

set +e
ssh "$REMOTE" "set -o pipefail; \
  docker exec -e ARTIFACT_DIR='/artifacts/$run_id' '$CONTAINER' \
    bash /workspace/scripts/mobile-autofill-fixture-remote.sh --inside '$variant' '$install' \
    2>&1 | tee '$REMOTE_ARTIFACTS/$run_id/output.log'; \
  code=\${PIPESTATUS[0]}; \
  printf '%s\n' \"\$code\" > '$REMOTE_ARTIFACTS/$run_id/exit-code.txt'; \
  docker ps --format '{{.Names}} {{.Status}}' > '$REMOTE_ARTIFACTS/$run_id/containers-after.txt'; \
  exit \"\$code\""
code=$?
set -e

if ! ssh "$REMOTE" "set -e; while read -r name rest; do \
  docker inspect \"\$name\" >/dev/null; \
  test \"\$(docker inspect --format '{{.State.Running}}' \"\$name\")\" = true; \
  health=\$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \"\$name\"); \
  test \"\$health\" = none || test \"\$health\" = healthy; \
  done < '$REMOTE_ARTIFACTS/$run_id/containers-before.txt'"; then
  echo "A pre-existing server container became unhealthy during the fixture run" >&2
  if [[ "$code" -eq 0 ]]; then code=1; fi
fi

synced_fingerprint="$(ssh "$REMOTE" "sed -n 's/^fingerprint=//p' '$REMOTE_SOURCE/.remote-sync'")"
current_fingerprint="$("$FINGERPRINT")"
stale=false
if [[ -z "$synced_fingerprint" || "$synced_fingerprint" != "$current_fingerprint" ]]; then
  stale=true
  if [[ "$code" -eq 0 ]]; then code=86; fi
fi
ssh "$REMOTE" "printf '%s\n' 'stale=$stale' > '$REMOTE_ARTIFACTS/$run_id/stale.txt'; \
  cd '$REMOTE_ARTIFACTS/$run_id'; \
  find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS"

echo "Remote run: $REMOTE:$REMOTE_ARTIFACTS/$run_id"
if [[ "$stale" == true ]]; then
  echo "Local source changed after sync; fixture result is stale and must be rerun" >&2
fi
exit "$code"
