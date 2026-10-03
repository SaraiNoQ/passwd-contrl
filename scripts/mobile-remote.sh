#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SYNC="$ROOT/scripts/mobile-remote-sync.sh"
REMOTE="root@campus-server"
REMOTE_SOURCE="/root/dev/zero-vault"
REMOTE_ARTIFACTS="/root/dev/zero-vault-artifacts"
REMOTE_LOCK="/root/dev/zero-vault-android.lock"
CONTAINER="zero-vault-android-dev"
COMPOSE="docker compose -p zero-vault-android -f infra/android/compose.yml"
FINGERPRINT="$ROOT/scripts/mobile-source-fingerprint.sh"
ROOM_SCHEMA_DIR="apps/mobile/modules/zero-vault-native/android/schemas"
ROOM_SCHEMA_DATABASE="expo.modules.zerovault.ZeroVaultDatabase"
ROOM_SCHEMA_VERSION=2

LOCK_ACQUIRED=false
LOCK_TOKEN=""
LAST_RUN_ID=""
REMOTE_INPUT_PATH=""

cleanup_remote_input() {
  local path="$REMOTE_INPUT_PATH"
  [[ -n "$path" ]] || return 0
  ssh "$REMOTE" "rm -f '$path' && test ! -e '$path'" || return 1
  REMOTE_INPUT_PATH=""
}

release_lock() {
  if [[ "$LOCK_ACQUIRED" == true && -n "$LOCK_TOKEN" ]]; then
    ssh "$REMOTE" "if [ \"\$(cat '$REMOTE_LOCK/owner' 2>/dev/null)\" = '$LOCK_TOKEN' ]; then rm -f '$REMOTE_LOCK/owner' && rmdir '$REMOTE_LOCK'; fi" >/dev/null 2>&1 || true
  fi
}

assert_snapshot_current() {
  local run_id="$1"
  local synced current stale=false
  synced="$(ssh "$REMOTE" "sed -n 's/^fingerprint=//p' '$REMOTE_SOURCE/.remote-sync'")"
  current="$("$FINGERPRINT")"
  if [[ -z "$synced" || "$synced" != "$current" ]]; then
    stale=true
  fi
  ssh "$REMOTE" "set -e; printf '%s\n' 'stale=$stale' > '$REMOTE_ARTIFACTS/$run_id/stale.txt'; cd '$REMOTE_ARTIFACTS/$run_id'; find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS; test -s exit-code.txt"
  if [[ "$stale" == true ]]; then
    echo "Local source changed after sync; remote result is stale and must be rerun." >&2
    return 86
  fi
}

usage() {
  echo "usage: $0 {bootstrap|shell|doctor|upgrade-expo|typecheck|test-ui|test-targeted|test|sbom|browser-cert|browser-cert-device <exported-chrome-base.apk>|build-debug|build-personal|build-play|upgrade-check <old-personal-run-id> <new-personal-run-id>|instrumented|emulator|e2e|e2e-local|e2e-recovery|e2e-system|e2e-editor-layout|e2e-multidevice|artifacts <supported-run-id>}"
}

remote_logged() {
  local label="$1"
  local command="$2"
  local input_file="${3:-}"
  local input_name="${4:-}"
  local run_id
  run_id="$(date -u +%Y%m%dT%H%M%SZ)-$label-$$-$RANDOM"
  LAST_RUN_ID="$run_id"

  if [[ -n "$input_file" ]]; then
    [[ -f "$input_file" && ! -L "$input_file" && -s "$input_file" ]] || {
      echo "Remote input must be a non-empty regular file." >&2
      return 2
    }
    [[ "$input_name" =~ ^[A-Za-z0-9._-]+$ ]] || {
      echo "Remote input name is invalid." >&2
      return 2
    }
  fi
  ssh "$REMOTE" "mkdir -p '$REMOTE_ARTIFACTS/$run_id' && cp '$REMOTE_SOURCE/.remote-sync' '$REMOTE_ARTIFACTS/$run_id/sync.txt' && docker ps --format '{{.Names}} {{.Status}}' > '$REMOTE_ARTIFACTS/$run_id/containers-before.txt' && { docker inspect --format '{{.Image}}' '$CONTAINER' 2>/dev/null || printf '%s\n' 'not-created'; } > '$REMOTE_ARTIFACTS/$run_id/image-id.txt'"
  if [[ -n "$input_file" ]]; then
    REMOTE_INPUT_PATH="$REMOTE_ARTIFACTS/$run_id/$input_name"
    rsync -az -- "$input_file" "$REMOTE:$REMOTE_ARTIFACTS/$run_id/$input_name"
    ssh "$REMOTE" "chmod 600 '$REMOTE_ARTIFACTS/$run_id/$input_name'"
  fi
  printf 'set -euo pipefail\nexport ARTIFACT_DIR=/artifacts/%s\n%s\n' "$run_id" "$command" \
    | ssh "$REMOTE" "cat > '$REMOTE_ARTIFACTS/$run_id/command.sh'"

  set +e
  ssh "$REMOTE" "set -o pipefail; docker exec '$CONTAINER' bash '/artifacts/$run_id/command.sh' 2>&1 | tee '$REMOTE_ARTIFACTS/$run_id/output.log'; code=\${PIPESTATUS[0]}; set -e; printf '%s\n' \"\$code\" > '$REMOTE_ARTIFACTS/$run_id/exit-code.txt'; docker ps --format '{{.Names}} {{.Status}}' > '$REMOTE_ARTIFACTS/$run_id/containers-after.txt'; while read -r name rest; do docker inspect \"\$name\" >/dev/null; test \"\$(docker inspect --format '{{.State.Running}}' \"\$name\")\" = true; health=\$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \"\$name\"); test \"\$health\" = none || test \"\$health\" = healthy; done < '$REMOTE_ARTIFACTS/$run_id/containers-before.txt'; cd '$REMOTE_ARTIFACTS/$run_id'; find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS; test -s exit-code.txt; exit \"\$code\""
  local code=$?
  set -e
  if [[ -n "$input_file" ]]; then
    if ! cleanup_remote_input; then
      echo "Failed to remove the staged remote input; refusing to accept this run." >&2
      code=87
    elif ! ssh "$REMOTE" "test ! -e '$REMOTE_ARTIFACTS/$run_id/$input_name' && printf '%s\n' 'removed=true' > '$REMOTE_ARTIFACTS/$run_id/input-cleanup.txt'"; then
      echo "Failed to persist remote input cleanup evidence; refusing to accept this run." >&2
      code=87
    fi
  fi
  if ! assert_snapshot_current "$run_id" && [[ "$code" -eq 0 ]]; then code=86; fi
  echo "Remote run: $REMOTE:$REMOTE_ARTIFACTS/$run_id"
  return "$code"
}

download_verified_run() {
  local run_id="$1"
  [[ "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z-(personal-release|play-aab|browser-cert-device|upgrade-check-api36|e2e-editor-layout|e2e-local)-[0-9]+-[0-9]+$ ]] || {
    echo "Unsupported artifact run id." >&2
    return 2
  }
  local remote_dir="$REMOTE_ARTIFACTS/$run_id"
  ssh "$REMOTE" "set -e; cd '$remote_dir'; grep -qx '0' exit-code.txt; grep -qx 'stale=false' stale.txt; sha256sum -c SHA256SUMS"
  if [[ "$run_id" == *-browser-cert-device-* ]]; then
    ssh "$REMOTE" "set -e; cd '$remote_dir'; grep -qx 'removed=true' input-cleanup.txt; test ! -e browser-base.apk"
  fi
  local local_dir="$ROOT/artifacts/mobile-remote/$run_id"
  mkdir -p "$local_dir"
  rsync -az "$REMOTE:$remote_dir/" "$local_dir/"
  (
    cd "$local_dir"
    sha256sum -c SHA256SUMS
    if [[ "$run_id" == *-personal-release-* || "$run_id" == *-play-aab-* ]]; then
      sha256sum -c artifact-SHA256SUMS
    elif [[ "$run_id" == *-browser-cert-device-* ]]; then
      sha256sum -c browser-cert-SHA256SUMS
      grep -qx 'removed=true' input-cleanup.txt
      test ! -e browser-base.apk
    fi
  )
  echo "Verified remote artifacts: $local_dir"
}

remote_host_logged() {
  local label="$1"
  local command="$2"
  local run_id
  run_id="$(date -u +%Y%m%dT%H%M%SZ)-$label-$$-$RANDOM"
  LAST_RUN_ID="$run_id"
  ssh "$REMOTE" "mkdir -p '$REMOTE_ARTIFACTS/$run_id' && cp '$REMOTE_SOURCE/.remote-sync' '$REMOTE_ARTIFACTS/$run_id/sync.txt' && docker ps --format '{{.Names}} {{.Status}}' > '$REMOTE_ARTIFACTS/$run_id/containers-before.txt' && { docker inspect --format '{{.Image}}' '$CONTAINER' 2>/dev/null || printf '%s\n' 'not-created'; } > '$REMOTE_ARTIFACTS/$run_id/image-id.txt'"
  printf 'set -euo pipefail\nexport ARTIFACT_DIR=%q\n%s\n' \
    "$REMOTE_ARTIFACTS/$run_id" "$command" |
    ssh "$REMOTE" "cat > '$REMOTE_ARTIFACTS/$run_id/command.sh'"
  set +e
  ssh "$REMOTE" "set -o pipefail; bash '$REMOTE_ARTIFACTS/$run_id/command.sh' 2>&1 | tee '$REMOTE_ARTIFACTS/$run_id/output.log'; code=\${PIPESTATUS[0]}; set -e; printf '%s\n' \"\$code\" > '$REMOTE_ARTIFACTS/$run_id/exit-code.txt'; docker ps --format '{{.Names}} {{.Status}}' > '$REMOTE_ARTIFACTS/$run_id/containers-after.txt'; while read -r name rest; do docker inspect \"\$name\" >/dev/null; test \"\$(docker inspect --format '{{.State.Running}}' \"\$name\")\" = true; health=\$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \"\$name\"); test \"\$health\" = none || test \"\$health\" = healthy; done < '$REMOTE_ARTIFACTS/$run_id/containers-before.txt'; cd '$REMOTE_ARTIFACTS/$run_id'; find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS; test -s exit-code.txt; exit \"\$code\""
  local code=$?
  set -e
  if ! assert_snapshot_current "$run_id" && [[ "$code" -eq 0 ]]; then code=86; fi
  echo "Remote host run: $REMOTE:$REMOTE_ARTIFACTS/$run_id"
  return "$code"
}

ensure_container() {
  ssh "$REMOTE" "docker inspect '$CONTAINER' >/dev/null 2>&1"
}

copy_generated_room_schemas() {
  local expected="$ROOM_SCHEMA_DIR/$ROOM_SCHEMA_DATABASE/$ROOM_SCHEMA_VERSION.json"
  ssh "$REMOTE" "test -s '$REMOTE_SOURCE/$expected'"
  mkdir -p "$ROOT/$ROOM_SCHEMA_DIR"
  rsync -az \
    --include='*/' \
    --include='*.json' \
    --exclude='*' \
    "$REMOTE:$REMOTE_SOURCE/$ROOM_SCHEMA_DIR/" \
    "$ROOT/$ROOM_SCHEMA_DIR/"
  jq -e ".formatVersion == 1 and .database.version == $ROOM_SCHEMA_VERSION" "$ROOT/$expected" >/dev/null
  echo "Copied generated Room schema JSON back to the local source of truth."
}

start_emulator() {
  local api="${1:-36}"
  case "$api" in 36) ;; *) echo "Only the latest pinned Android API 36 may be tested" >&2; return 2 ;; esac
  remote_logged "emulator-start-api${api}" "adb -e emu kill >/dev/null 2>&1 || true
for i in \$(seq 1 60); do
  if ! adb devices | awk '\$1 ~ /^emulator-/ && \$2 != \"\" { found=1 } END { exit !found }' &&
     ! pgrep -f '[q]emu-system.*-avd zero-vault-api${api}' >/dev/null; then
    break
  fi
  sleep 1
done
if adb devices | awk '\$1 ~ /^emulator-/ && \$2 != \"\" { found=1 } END { exit !found }' ||
   pgrep -f '[q]emu-system.*-avd zero-vault-api${api}' >/dev/null; then
  echo 'The previous emulator did not stop; refusing to start a second instance.' >&2
  exit 1
fi
test -f /root/.android/avd/zero-vault-api${api}.avd/config.ini || echo no | avdmanager create avd --force --name zero-vault-api${api} --package 'system-images;android-${api};google_apis;x86_64' --device pixel_6
nohup emulator -avd zero-vault-api${api} -wipe-data -no-snapshot -no-snapshot-save -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -accel on </dev/null >/tmp/zero-vault-emulator-api${api}.log 2>&1 &"
}

COMMAND="${1:-}"
case "$COMMAND" in
  bootstrap|shell|doctor|upgrade-expo|typecheck|test-ui|test-targeted|test|sbom|browser-cert|browser-cert-device|build-debug|build-personal|build-play|upgrade-check|instrumented|emulator|e2e|e2e-local|e2e-recovery|e2e-system|e2e-editor-layout|e2e-multidevice)
    LOCK_TOKEN="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM-$RANDOM"
    ssh "$REMOTE" "if mkdir '$REMOTE_LOCK'; then printf '%s\n' '$LOCK_TOKEN' > '$REMOTE_LOCK/owner' || { rmdir '$REMOTE_LOCK'; exit 1; }; else exit 1; fi" || {
      echo "Another Android sync/build owns $REMOTE_LOCK; refusing concurrent execution." >&2
      exit 1
    }
    LOCK_ACQUIRED=true
    export MOBILE_REMOTE_LOCK_TOKEN="$LOCK_TOKEN"
    trap 'cleanup_remote_input >/dev/null 2>&1 || true; release_lock' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    ;;
esac
case "$COMMAND" in
  bootstrap)
    "$SYNC"
    remote_host_logged image-build "cd '$REMOTE_SOURCE'
$COMPOSE up -d --build"
    remote_logged bootstrap "corepack enable
pnpm config set store-dir /opt/pnpm-store
pnpm config set network-concurrency 8
pnpm config set fetch-retries 5
pnpm config set fetch-retry-mintimeout 1000
pnpm config set fetch-retry-maxtimeout 10000
pnpm config set fetch-timeout 30000
pnpm install --prefer-offline --no-frozen-lockfile
cargo fetch --manifest-path crates/crypto-core/Cargo.toml
test -f /root/.android/avd/zero-vault-api36.avd/config.ini || echo no | avdmanager create avd --force --name zero-vault-api36 --package 'system-images;android-36;google_apis;x86_64' --device pixel_6"
    rsync -az "$REMOTE:$REMOTE_SOURCE/pnpm-lock.yaml" "$ROOT/pnpm-lock.yaml"
    rsync -az "$REMOTE:$REMOTE_SOURCE/crates/crypto-core/Cargo.lock" "$ROOT/crates/crypto-core/Cargo.lock"
    echo "Copied the remotely resolved pnpm and Cargo lockfiles back to the local source of truth."
    ;;
  shell)
    ensure_container
    ssh -t "$REMOTE" "docker exec -it '$CONTAINER' bash"
    ;;
  doctor)
    "$SYNC"
    ensure_container
    remote_logged doctor "java -version 2>&1 | tee /tmp/java-version
grep -q '17\\.' /tmp/java-version
test \"\$(node --version)\" = v22.23.1
node --version
test \"\$(pnpm --version)\" = 9.15.0
pnpm --version
rustc --version | tee /tmp/rust-version
grep -q 'rustc 1.88.0' /tmp/rust-version
rustup target list --installed | sort | tee /tmp/rust-targets
grep -qx 'aarch64-linux-android' /tmp/rust-targets
grep -qx 'x86_64-linux-android' /tmp/rust-targets
cargo ndk --version
test -d \"\$ANDROID_HOME/ndk/27.1.12297006\"
test -x \"\$ANDROID_HOME/build-tools/35.0.0/aapt2\"
test -x \"\$ANDROID_HOME/build-tools/36.0.0/zipalign\"
test -x \"\$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer\"
test \"\$(bundletool version)\" = 1.18.3
echo 'a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29  /opt/bundletool/bundletool.jar' | sha256sum -c -
test -c /dev/kvm
sdkmanager --list_installed | tee /tmp/android-packages
grep -q 'platforms;android-36' /tmp/android-packages
grep -q 'build-tools;35.0.0' /tmp/android-packages
grep -q 'build-tools;36.0.0' /tmp/android-packages
grep -q 'system-images;android-36;google_apis;x86_64' /tmp/android-packages
sdkmanager --version
adb version
emulator -version | head -1
maestro --version | tee /tmp/maestro-version
grep -q '2.6.1' /tmp/maestro-version
cd apps/mobile
pnpm exec expo config --json --full > "\$ARTIFACT_DIR/expo-config.json"
expo_cli=\$(node -p \"require.resolve('expo/bin/cli')\")
EXPO_CONFIG_PLUGIN_VERBOSE_ERRORS=1 EXPO_DEBUG=1 node \"\$expo_cli\" config --json --full > \"\$ARTIFACT_DIR/expo-node-config.json\"
EXPO_CONFIG_PLUGIN_VERBOSE_ERRORS=1 EXPO_DEBUG=1 pnpm dlx expo-doctor@1.20.1 --verbose 2>&1 | tee "\$ARTIFACT_DIR/expo-doctor.txt"
! grep -q '^Error:' "\$ARTIFACT_DIR/expo-doctor.txt""
    ;;
  upgrade-expo)
    "$SYNC"
    ensure_container
    remote_logged expo-prepare "cd /workspace
pnpm install --prefer-offline --no-frozen-lockfile
node -e \"const fs=require('fs'); fs.rmSync('apps/mobile/android',{recursive:true,force:true}); fs.rmSync('apps/mobile/ios',{recursive:true,force:true})\""
    for sdk in 52 53 54 55 56 57; do
      current_local="$(node -e "process.stdout.write(require('$ROOT/apps/mobile/package.json').dependencies.expo.match(/[0-9]+/)[0])")"
      if [[ "$sdk" -lt "$current_local" ]]; then continue; fi
      remote_logged "expo-sdk$sdk" "cd apps/mobile
current=\$(node -e \"process.stdout.write(require('./package.json').dependencies.expo.match(/[0-9]+/)[0])\")
if [ \"\$current\" -lt $sdk ]; then
  pnpm add \"expo@~$sdk.0.0\"
fi
EXPO_OFFLINE=1 pnpm exec expo install --fix
if [ "$sdk" -eq 55 ]; then
  # SDK 55's bundled-module manifest selects 0.83.10 while the SDK 55
  # expo-doctor compatibility data requires 0.83.6.
  pnpm add react-native@0.83.6
  cd /workspace
  node - <<'NODE'
const fs = require('fs');
const path = require('path');
for (const base of ['apps', 'packages']) {
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      fs.rmSync(path.join(base, entry.name, 'node_modules'), { recursive: true, force: true });
    }
  }
}
fs.rmSync('node_modules', { recursive: true, force: true });
NODE
fi
cd /workspace
pnpm install --prefer-offline --no-frozen-lockfile
cd apps/mobile
npx expo-doctor
pnpm typecheck
pnpm test
pnpm exec expo prebuild --platform android --clean
test -f android/settings.gradle
node -e \"const fs=require('fs'); fs.rmSync('android',{recursive:true,force:true}); fs.rmSync('ios',{recursive:true,force:true})\"
echo \"Expo SDK $sdk manifest, tests and Android prebuild verified\""
      rsync -az "$REMOTE:$REMOTE_SOURCE/apps/mobile/package.json" "$ROOT/apps/mobile/package.json"
      rsync -az "$REMOTE:$REMOTE_SOURCE/pnpm-lock.yaml" "$ROOT/pnpm-lock.yaml"
      "$SYNC"
    done
    echo "Copied the verified Expo 57 package manifest and lockfile back to the local source of truth."
    ;;
  typecheck)
    "$SYNC"
    ensure_container
    remote_logged typecheck "pnpm --filter @zero-vault/mobile typecheck
pnpm --filter @zero-vault/shared typecheck
pnpm --filter @zero-vault/worker-api typecheck
pnpm --filter @zero-vault/web typecheck"
    ;;
  test-ui)
    "$SYNC"
    ensure_container
    remote_logged test-ui "pnpm --filter @zero-vault/mobile exec vitest run \
src/test/i18n.test.ts \
src/test/theme.test.ts \
src/test/folder-suggestions.test.ts \
src/test/vault-folder-sections.test.ts \
src/test/mobile-api-client.test.ts \
src/test/session-route-guard.test.ts"
    ;;
  test-targeted)
    "$SYNC"
    ensure_container
    remote_logged test-targeted "pnpm --filter @zero-vault/mobile exec vitest run \
src/test/i18n.test.ts \
src/test/theme.test.ts \
src/test/folder-suggestions.test.ts \
src/test/vault-folder-sections.test.ts \
src/test/mobile-api-client.test.ts \
src/test/session-route-guard.test.ts \
src/test/native-mobile-auth-adapter.test.ts \
src/test/native-backup-bridge.test.ts
pnpm --filter @zero-vault/worker-api exec vitest run \
src/routes/auth.test.ts
pnpm --filter @zero-vault/web exec vitest run \
lib/recovery.test.ts \
lib/vault-recovery.test.ts"
    ;;
  test)
    "$SYNC"
    ensure_container
    remote_logged test "pnpm --filter @zero-vault/mobile test
pnpm --filter @zero-vault/shared test
pnpm --filter @zero-vault/worker-api test
pnpm --filter @zero-vault/web test
cargo test --locked --manifest-path crates/crypto-core/Cargo.toml
cargo test --locked --manifest-path crates/crypto-core/Cargo.toml --features uniffi
mkdir -p "\$ARTIFACT_DIR/jniLibs"
cd crates/crypto-core
cargo ndk -t arm64-v8a -t x86_64 -o "\$ARTIFACT_DIR/jniLibs" build --release --locked --features uniffi
cd /workspace
mkdir -p "\$ARTIFACT_DIR/uniffi-kotlin"
cd crates/crypto-core
cargo run --locked --features uniffi-cli --bin uniffi-bindgen -- generate --library "\$ARTIFACT_DIR/jniLibs/arm64-v8a/libcrypto_core.so" --language kotlin --out-dir "\$ARTIFACT_DIR/uniffi-kotlin""
    ;;
  sbom)
    "$SYNC"
    ensure_container
    remote_logged sbom "bash scripts/mobile-create-sbom.sh debug"
    ;;
  browser-cert)
    "$SYNC"
    ensure_container
    remote_logged browser-cert-api36 "bash scripts/mobile-browser-cert-avd.sh"
    ;;
  browser-cert-device)
    browser_apk="${2:-}"
    [[ -n "$browser_apk" ]] || {
      echo "browser-cert-device requires the Chrome base APK exported from the owner device." >&2
      exit 2
    }
    "$SYNC"
    ensure_container
    remote_logged \
      browser-cert-device \
      "bash scripts/mobile-browser-cert-apk.sh \"\$ARTIFACT_DIR/browser-base.apk\"" \
      "$browser_apk" \
      browser-base.apk
    download_verified_run "$LAST_RUN_ID"
    expected_browser_apk_sha256="$(
      sed -n 's/^browserApkSha256=//p' \
        "$ROOT/artifacts/mobile-remote/$LAST_RUN_ID/browser-version.txt"
    )"
    actual_browser_apk_sha256="$(LC_ALL=C shasum -a 256 -- "$browser_apk" | awk '{print $1}')"
    [[ "$expected_browser_apk_sha256" =~ ^[0-9a-f]{64}$ &&
      "$actual_browser_apk_sha256" == "$expected_browser_apk_sha256" ]] || {
      echo "Downloaded certificate evidence does not match the selected local Chrome APK." >&2
      exit 1
    }
    echo "Verified browser APK input SHA-256: $actual_browser_apk_sha256"
    ;;
  build-debug)
    "$SYNC"
    ensure_container
    remote_logged build-debug "cd apps/mobile
pnpm exec expo prebuild --platform android --clean
cd android
./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk \"\$ARTIFACT_DIR/\"
sha256sum \"\$ARTIFACT_DIR/app-debug.apk\" > \"\$ARTIFACT_DIR/artifact-SHA256SUMS\""
    copy_generated_room_schemas
    ;;
  build-personal)
    "$SYNC"
    ensure_container
    start_emulator 36
    remote_host_logged personal-release \
      "ARTIFACT_DIR=\${ARTIFACT_DIR:?} bash '$REMOTE_SOURCE/scripts/mobile-personal-release-host.sh'"
    copy_generated_room_schemas
    ;;
  build-play)
    "$SYNC"
    ensure_container
    remote_host_logged play-aab \
      "ARTIFACT_DIR=\${ARTIFACT_DIR:?} bash '$REMOTE_SOURCE/scripts/mobile-play-release-host.sh'"
    copy_generated_room_schemas
    download_verified_run "$LAST_RUN_ID"
    ;;
  upgrade-check)
    old_run="${2:-}"
    new_run="${3:-}"
    for run_id in "$old_run" "$new_run"; do
      [[ "$run_id" =~ ^[0-9]{8}T[0-9]{6}Z-personal-release-[0-9]+-[0-9]+$ ]] || {
        echo "upgrade-check requires two exact personal-release run ids." >&2
        exit 2
      }
      ssh "$REMOTE" "set -e; cd '$REMOTE_ARTIFACTS/$run_id'; grep -qx '0' exit-code.txt; grep -qx 'stale=false' stale.txt; sha256sum -c SHA256SUMS; sha256sum -c artifact-SHA256SUMS"
    done
    "$SYNC"
    current_fingerprint="$(
      ssh "$REMOTE" "sed -n 's/^fingerprint=//p' '$REMOTE_SOURCE/.remote-sync'"
    )"
    new_run_fingerprint="$(
      ssh "$REMOTE" "sed -n 's/^fingerprint=//p' '$REMOTE_ARTIFACTS/$new_run/sync.txt'"
    )"
    [[ "$current_fingerprint" =~ ^[0-9a-f]{64}$ &&
      "$new_run_fingerprint" == "$current_fingerprint" ]] || {
      echo "The new APK was built from a different source fingerprint; rebuild it before upgrade-check." >&2
      exit 1
    }
    ensure_container
    start_emulator 36
    remote_logged upgrade-check-api36 "old_apk='/artifacts/$old_run/zero-vault-personal-release.apk'
new_apk='/artifacts/$new_run/zero-vault-personal-release.apk'
apkanalyzer=\"\$ANDROID_HOME/cmdline-tools/latest/bin/apkanalyzer\"
apksigner=\"\$ANDROID_HOME/build-tools/36.0.0/apksigner\"
for apk in \"\$old_apk\" \"\$new_apk\"; do
  test -s \"\$apk\"
  \"\$apksigner\" verify --verbose --print-certs \"\$apk\"
  test \"\$(\"\$apkanalyzer\" manifest application-id \"\$apk\")\" = com.zerovault.mobile
done
old_version=\$(\"\$apkanalyzer\" manifest version-code \"\$old_apk\")
new_version=\$(\"\$apkanalyzer\" manifest version-code \"\$new_apk\")
test \"\$new_version\" -gt \"\$old_version\"
old_apk_sha256=\$(sha256sum \"\$old_apk\" | awk '{print \$1}')
new_apk_sha256=\$(sha256sum \"\$new_apk\" | awk '{print \$1}')
old_expected_sha256=\$(awk '\$2 == \"zero-vault-personal-release.apk\" {print \$1}' \"/artifacts/$old_run/artifact-SHA256SUMS\")
new_expected_sha256=\$(awk '\$2 == \"zero-vault-personal-release.apk\" {print \$1}' \"/artifacts/$new_run/artifact-SHA256SUMS\")
test \"\${#old_apk_sha256}\" = 64
test \"\${#new_apk_sha256}\" = 64
test \"\$old_apk_sha256\" = \"\$old_expected_sha256\"
test \"\$new_apk_sha256\" = \"\$new_expected_sha256\"
old_cert=\$(\"\$apksigner\" verify --print-certs \"\$old_apk\" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | tr -cd '0-9A-Fa-f' | tr '[:lower:]' '[:upper:]')
new_cert=\$(\"\$apksigner\" verify --print-certs \"\$new_apk\" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | tr -cd '0-9A-Fa-f' | tr '[:lower:]' '[:upper:]')
test \"\${#old_cert}\" = 64
test \"\$old_cert\" = \"\$new_cert\"
timeout 240 adb wait-for-device
timeout 240 bash -c 'until [ \"\$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d \"\\r\")\" = 1 ]; do sleep 2; done'
test \"\$(adb shell getprop ro.build.version.sdk | tr -d '\\r')\" = 36
adb install \"\$old_apk\" | tee \"\$ARTIFACT_DIR/install-old.txt\"
grep -q '^Success' \"\$ARTIFACT_DIR/install-old.txt\"
old_uid=\$(adb shell pm list packages -U com.zerovault.mobile | sed -n 's/.* uid:\\([0-9]*\\).*/\\1/p' | tr -d '\\r')
test -n \"\$old_uid\"
adb install -r \"\$new_apk\" | tee \"\$ARTIFACT_DIR/install-new.txt\"
grep -q '^Success' \"\$ARTIFACT_DIR/install-new.txt\"
new_uid=\$(adb shell pm list packages -U com.zerovault.mobile | sed -n 's/.* uid:\\([0-9]*\\).*/\\1/p' | tr -d '\\r')
installed_version=\$(adb shell dumpsys package com.zerovault.mobile | sed -n 's/.*versionCode=\\([0-9]*\\).*/\\1/p' | head -1 | tr -d '\\r')
test \"\$old_uid\" = \"\$new_uid\"
test \"\$installed_version\" = \"\$new_version\"
printf '%s\n' \
  'scope=api36-package-manager-compatibility-only' \
  \"oldRun=$old_run\" \
  \"newRun=$new_run\" \
  \"oldApkSha256=\$old_apk_sha256\" \
  \"newApkSha256=\$new_apk_sha256\" \
  \"oldVersionCode=\$old_version\" \
  \"newVersionCode=\$new_version\" \
  \"signingCertificateSha256=\$new_cert\" \
  \"sourceFingerprint=$current_fingerprint\" \
  \"preservedUid=\$new_uid\" \
  > \"\$ARTIFACT_DIR/upgrade-check.txt\""
    download_verified_run "$LAST_RUN_ID"
    ;;
  instrumented)
    "$SYNC"
    ensure_container
    start_emulator 36
    remote_logged instrumented-api36 "timeout 240 adb wait-for-device
timeout 240 bash -c 'until [ \"\$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d \"\\r\")\" = 1 ]; do sleep 2; done'
cp /tmp/zero-vault-emulator-api36.log \"\$ARTIFACT_DIR/emulator.log\"
test \"\$(adb shell getprop ro.build.version.sdk | tr -d '\\r')\" = 36
cd apps/mobile
pnpm exec expo prebuild --platform android --clean
cd android
./gradlew :zero-vault-zero-vault-native:connectedDebugAndroidTest
results=/workspace/apps/mobile/modules/zero-vault-native/android/build
find \"\$results/outputs/androidTest-results/connected\" -type f | sort | tee \"\$ARTIFACT_DIR/instrumented-results.txt\"
test -s \"\$ARTIFACT_DIR/instrumented-results.txt\"
find \"\$results/reports/androidTests\" -type f -exec cp --parents '{}' \"\$ARTIFACT_DIR\" ';'"
    copy_generated_room_schemas
    ;;
  emulator)
    "$SYNC"
    ensure_container
    start_emulator 36
    remote_logged emulator "echo emulator-check-started
timeout 180 adb wait-for-device
timeout 180 bash -c 'until [ \"\$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d \"\\r\")\" = 1 ]; do sleep 2; done'
cp /tmp/zero-vault-emulator-api36.log "\$ARTIFACT_DIR/emulator.log"
adb devices -l | tee "\$ARTIFACT_DIR/adb-devices.txt"
grep -q 'emulator-.*device' "\$ARTIFACT_DIR/adb-devices.txt""
    ;;
  e2e)
    "$SYNC"
    ensure_container
    start_emulator 36
    remote_logged e2e "test -f /run/zero-vault-secrets/e2e.env
case \"\$(stat -c '%a' /run/zero-vault-secrets/e2e.env)\" in 400|600) ;; *) echo 'e2e.env must have mode 400 or 600' >&2; exit 1 ;; esac
set -a
. /run/zero-vault-secrets/e2e.env
set +a
: \"\${EXPO_PUBLIC_ZERO_VAULT_API_URL:?Missing isolated E2E Worker URL}\"
test \"\${ZERO_VAULT_E2E_CONFIRM_DESTRUCTIVE:-}\" = YES
case \"\$EXPO_PUBLIC_ZERO_VAULT_API_URL\" in https://*) ;; *) echo 'E2E Worker URL must use HTTPS' >&2; exit 1 ;; esac
case \"\$EXPO_PUBLIC_ZERO_VAULT_API_URL\" in *invalid*|*localhost*|*127.0.0.1*) echo 'Refusing invalid/local E2E Worker URL' >&2; exit 1 ;; esac
e2e_host=\$(node -e \"process.stdout.write(new URL(process.env.EXPO_PUBLIC_ZERO_VAULT_API_URL).hostname)\")
printf '%s' \"\$e2e_host\" | grep -Eiq '(^|[.-])(e2e|test|testing|staging)([.-]|$)' || { echo 'E2E Worker hostname must identify an isolated test environment' >&2; exit 1; }
printf '%s\n' \"apiHost=\$e2e_host\" > \"\$ARTIFACT_DIR/e2e-environment.txt\"
echo e2e-started
timeout 180 adb wait-for-device
timeout 180 bash -c 'until [ \"\$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d \"\\r\")\" = 1 ]; do sleep 2; done'
cp /tmp/zero-vault-emulator-api36.log \"\$ARTIFACT_DIR/emulator.log\"
cd apps/mobile
pnpm exec expo prebuild --platform android --clean
cd android
./gradlew installDebug
adb shell pm path com.zerovault.mobile | tee "\$ARTIFACT_DIR/installed-package.txt"
grep -q '^package:' "\$ARTIFACT_DIR/installed-package.txt"
cd /workspace/apps/mobile
NODE_ENV=development CI=1 nohup pnpm exec expo start --dev-client --localhost --port 8081 > "\$ARTIFACT_DIR/metro.log" 2>&1 &
metro_pid=\$!
sensitive_output=/tmp/zero-vault-maestro-sensitive-\$\$
trap 'adb shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true; rm -rf "\$sensitive_output"; kill "\$metro_pid" >/dev/null 2>&1 || true' EXIT
timeout 120 bash -c 'until curl -fsS http://127.0.0.1:8081/status | grep -q packager-status:running; do sleep 2; done'
adb reverse tcp:8081 tcp:8081
adb shell cmd connectivity airplane-mode disable >/dev/null
cd /workspace
mkdir -p "\$ARTIFACT_DIR/maestro-output"
maestro test --format junit --output "\$ARTIFACT_DIR/maestro-junit.xml" --test-output-dir "\$ARTIFACT_DIR/maestro-output/smoke" apps/mobile/.maestro/smoke.yml
test -s "\$ARTIFACT_DIR/maestro-junit.xml"
printf '%s\n' 'not-run: use e2e-local for the API 36 cold-restart offline harness' > "\$ARTIFACT_DIR/offline-restart.txt"
mkdir -m 700 "\$sensitive_output"
if maestro test --format junit --output "\$sensitive_output/junit.xml" --test-output-dir "\$sensitive_output/output" apps/mobile/.maestro/production-client.yml > "\$sensitive_output/console.log" 2>&1; then
  test -s "\$sensitive_output/junit.xml"
  printf '%s\n' \
    'api=36' \
    'productionClient=passed' \
    'sensitiveOutputRetained=false' \
    > "\$ARTIFACT_DIR/business-golden.txt"
else
  echo 'Sensitive recovery E2E failed; raw output was redacted and destroyed.' >&2
  exit 1
fi
rm -rf "\$sensitive_output"
test -s "\$ARTIFACT_DIR/metro.log"
echo e2e-complete"
    ;;
  e2e-local)
    "$SYNC"
    ensure_container
    start_emulator 36
    remote_logged e2e-local "bash scripts/mobile-e2e-local.sh"
    ;;
  e2e-recovery)
    "$SYNC"
    ensure_container
    start_emulator 36
    remote_logged e2e-local "ZERO_VAULT_E2E_SCOPE=recovery bash scripts/mobile-e2e-local.sh"
    ;;
  e2e-system)
    "$SYNC"
    ensure_container
    start_emulator 36
    remote_logged e2e-system "ZERO_VAULT_E2E_SCOPE=system bash scripts/mobile-e2e-local.sh"
    ;;
  e2e-editor-layout)
    "$SYNC"
    ensure_container
    start_emulator 36
    remote_logged e2e-editor-layout "ZERO_VAULT_E2E_SCOPE=editor-layout bash scripts/mobile-e2e-local.sh"
    download_verified_run "$LAST_RUN_ID"
    ;;
  e2e-multidevice)
    "$SYNC"
    ensure_container
    remote_logged e2e-multidevice-api36 "bash scripts/mobile-e2e-two-device.sh"
    ;;
  artifacts)
    run_id="${2:-}"
    download_verified_run "$run_id"
    ;;
  *)
    usage
    exit 2
    ;;
esac
