#!/usr/bin/env bash
set -euo pipefail

: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"
: "${ANDROID_HOME:?ANDROID_HOME is required}"

device_a="emulator-5554"
device_b="emulator-5556"
avd_a="zero-vault-api36-two-device-a"
avd_b="zero-vault-api36-two-device-b"
run_root="$(mktemp -d /tmp/zero-vault-e2e-two-device.XXXXXX)"
state="$run_root/wrangler-state"
sensitive_output="$run_root/sensitive"
tls_key="$run_root/e2e.key"
tls_cert="$run_root/e2e.crt"
wrangler_log="$run_root/wrangler.log"
tls_proxy_log="$run_root/tls-proxy.log"
metro_log="$run_root/metro.log"
emulator_a_log="$run_root/emulator-a.log"
emulator_b_log="$run_root/emulator-b.log"
wrangler_pid=""
tls_proxy_pid=""
metro_pid=""
emulator_a_pid=""
emulator_b_pid=""
dedicated_avds_owned=false
control_token=""

stop_group() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  kill -TERM -- "-$pid" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    kill -0 "$pid" >/dev/null 2>&1 || break
    sleep 0.25
  done
  kill -KILL -- "-$pid" >/dev/null 2>&1 || true
  wait "$pid" >/dev/null 2>&1 || true
}

stop_owned_emulator() {
  local serial="$1"
  local expected_avd="$2"
  local pid="$3"
  [[ -n "$pid" ]] || return 0
  local reported_avd=""
  if adb -s "$serial" get-state >/dev/null 2>&1; then
    reported_avd="$(adb -s "$serial" emu avd name 2>/dev/null | head -1 | tr -d '\r')"
    if [[ "$reported_avd" != "$expected_avd" ]]; then
      echo "Refusing to stop unexpected AVD $reported_avd on $serial." >&2
      stop_group "$pid"
      return 1
    fi
    adb -s "$serial" emu kill >/dev/null 2>&1 || true
    for _ in $(seq 1 60); do
      adb -s "$serial" get-state >/dev/null 2>&1 || break
      sleep 1
    done
  fi
  stop_group "$pid"
  for _ in $(seq 1 30); do
    adb -s "$serial" get-state >/dev/null 2>&1 || break
    sleep 1
  done
  ! adb -s "$serial" get-state >/dev/null 2>&1
}

delete_dedicated_avd() {
  local name="$1"
  local directory="/root/.android/avd/$name.avd"
  local config="/root/.android/avd/$name.ini"
  if [[ -e "$directory" || -e "$config" ]]; then
    avdmanager delete avd -n "$name" >/dev/null 2>&1 || true
  fi
  # These exact hard-coded test paths contain userdata and Android Keystore
  # state. No wildcard or non-test AVD path is permitted here.
  rm -rf -- "$directory"
  rm -f -- "$config"
  test ! -e "$directory"
  test ! -e "$config"
}

remove_test_avds() {
  [[ "$dedicated_avds_owned" == true ]] || return 0
  local failed=0
  stop_owned_emulator "$device_a" "$avd_a" "$emulator_a_pid" || failed=1
  emulator_a_pid=""
  stop_owned_emulator "$device_b" "$avd_b" "$emulator_b_pid" || failed=1
  emulator_b_pid=""
  delete_dedicated_avd "$avd_a" || failed=1
  delete_dedicated_avd "$avd_b" || failed=1
  return "$failed"
}

cleanup() {
  local original_status=$?
  trap - EXIT
  set +e
  remove_test_avds
  local avd_cleanup_status=$?
  stop_group "$metro_pid"
  stop_group "$tls_proxy_pid"
  stop_group "$wrangler_pid"
  [[ -f "$wrangler_log" ]] && cp "$wrangler_log" "$ARTIFACT_DIR/wrangler.log"
  [[ -f "$tls_proxy_log" ]] && cp "$tls_proxy_log" "$ARTIFACT_DIR/tls-proxy.log"
  [[ -f "$metro_log" ]] && cp "$metro_log" "$ARTIFACT_DIR/metro.log"
  [[ -f "$emulator_a_log" ]] && cp "$emulator_a_log" "$ARTIFACT_DIR/emulator-a.log"
  [[ -f "$emulator_b_log" ]] && cp "$emulator_b_log" "$ARTIFACT_DIR/emulator-b.log"
  case "$run_root" in
    /tmp/zero-vault-e2e-two-device.*) [[ -d "$run_root" ]] && rm -rf -- "$run_root" ;;
  esac
  if [[ "$avd_cleanup_status" -ne 0 ]]; then
    echo "Dedicated two-device AVD cleanup failed." >&2
    exit 87
  fi
  exit "$original_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

write_sanitized_maestro_status() {
  local source_dir="$1"
  local target="$2"
  local command_file
  command_file="$(find "$source_dir" -type f -name 'commands-*.json' -print -quit)"
  [[ -n "$command_file" ]] || return 1
  node -e '
    const fs = require("node:fs");
    const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
      .map(({ command, metadata }) => ({
        sequenceNumber: metadata.sequenceNumber,
        status: metadata.status,
        commandType: Object.keys(command)[0] ?? "unknown",
      }))
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber);
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
  ' "$command_file" > "$target"
}

run_sensitive_maestro() {
  local serial="$1"
  local label="$2"
  local flow="$3"
  shift 3
  local flow_output="$sensitive_output/$label"
  local retry_status="$flow_output/launch-retry-status.json"
  local attempt=1
  mkdir -m 700 "$flow_output"
  while true; do
    if maestro --device "$serial" test \
      "$@" \
      --format junit \
      --output "$flow_output/junit.xml" \
      --test-output-dir "$flow_output/output" \
      "$flow" \
      >"$flow_output/console.log" 2>&1 &&
      test -s "$flow_output/junit.xml"; then
      printf '%s=passed\n' "$label" >> "$ARTIFACT_DIR/two-device-stages.txt"
      return 0
    fi
    write_sanitized_maestro_status "$flow_output/output" "$retry_status" || true
    if (( attempt == 1 )) && node -e '
      const fs = require("node:fs");
      const rows = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const last = rows.at(-1);
      process.exit(
        rows.length === 3 &&
        rows.slice(0, -1).every((row) => row.status === "COMPLETED") &&
        last?.status === "FAILED" &&
        last?.commandType === "launchAppCommand"
          ? 0
          : 1,
      );
    ' "$retry_status"; then
      attempt=2
      adb -s "$serial" shell am force-stop com.zerovault.mobile || true
      rm -rf "$flow_output/output"
      rm -f "$flow_output/junit.xml" "$flow_output/console.log" "$retry_status"
      sleep 2
      continue
    fi
    break
  done
  write_sanitized_maestro_status \
    "$flow_output/output" \
    "$ARTIFACT_DIR/maestro-$label-command-status.json" || true
  if [[ "$label" == a-bootstrap ]]; then
    # This failure happens before the flow enters any account data. Retain a
    # bounded launcher-only diagnostic so URL/manifest failures can be fixed
    # without preserving later sensitive Maestro output.
    adb -s "$serial" shell uiautomator dump /sdcard/zero-vault-launcher-failure.xml \
      >/dev/null 2>&1 || true
    adb -s "$serial" exec-out cat /sdcard/zero-vault-launcher-failure.xml \
      >"$ARTIFACT_DIR/launcher-failure-ui.xml" 2>/dev/null || true
    adb -s "$serial" shell rm /sdcard/zero-vault-launcher-failure.xml \
      >/dev/null 2>&1 || true
    adb -s "$serial" exec-out screencap -p \
      >"$ARTIFACT_DIR/launcher-failure.png" 2>/dev/null || true
    adb -s "$serial" logcat -d -v brief \
      | grep -E 'DevLauncher|Expo|ReactNative|Cleartext|UnknownHost|ConnectException|NetworkSecurity' \
      | tail -n 240 \
      >"$ARTIFACT_DIR/launcher-failure-logcat.txt" || true
  elif [[ "$label" =~ ^b-.*-(resolve|final-value|final-values)$ ]]; then
    # Conflict journeys use a fresh synthetic account and the conflict screen
    # deliberately excludes passwords, TOTP, notes, card data and custom-field
    # values. Preserve only the current Android UI and a screenshot so a route
    # or visibility failure can be diagnosed without retaining raw Maestro
    # output, generated credentials, recovery material or network logs.
    adb -s "$serial" shell uiautomator dump /sdcard/zero-vault-conflict-failure.xml \
      >/dev/null 2>&1 || true
    adb -s "$serial" exec-out cat /sdcard/zero-vault-conflict-failure.xml \
      >"$ARTIFACT_DIR/maestro-$label-ui.xml" 2>/dev/null || true
    adb -s "$serial" shell rm /sdcard/zero-vault-conflict-failure.xml \
      >/dev/null 2>&1 || true
    adb -s "$serial" exec-out screencap -p \
      >"$ARTIFACT_DIR/maestro-$label.png" 2>/dev/null || true
  fi
  echo "$label failed; raw sensitive Maestro output was destroyed." >&2
  return 1
}

create_avd() {
  local name="$1"
  test -f "/root/.android/avd/$name.avd/config.ini" ||
    echo no | avdmanager create avd \
      --force \
      --name "$name" \
      --package 'system-images;android-36;google_apis;x86_64' \
      --device pixel_6
}

wait_for_device() {
  local serial="$1"
  timeout 240 adb -s "$serial" wait-for-device
  timeout 240 bash -c \
    "until [ \"\$(adb -s '$serial' shell getprop sys.boot_completed 2>/dev/null | tr -d '\\r')\" = 1 ]; do sleep 2; done"
  test "$(adb -s "$serial" shell getprop ro.build.version.sdk | tr -d '\r')" = 36
  adb -s "$serial" shell settings put global window_animation_scale 0
  adb -s "$serial" shell settings put global transition_animation_scale 0
  adb -s "$serial" shell settings put global animator_duration_scale 0
  adb -s "$serial" shell input keyevent KEYCODE_HOME
  sleep 5
}

unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
export CI=1 WRANGLER_SEND_METRICS=false NO_UPDATE_NOTIFIER=1
mkdir -m 700 "$state" "$sensitive_output"
>"$ARTIFACT_DIR/two-device-stages.txt"

command -v maestro >/dev/null
command -v openssl >/dev/null
test -c /dev/kvm
control_token="$(openssl rand -hex 32)"
[[ "$control_token" =~ ^[0-9a-f]{64}$ ]]
if [[ ! -x /workspace/apps/worker-api/node_modules/.bin/wrangler ||
      ! -x /workspace/apps/mobile/node_modules/.bin/expo ]]; then
  (cd /workspace && env -u NODE_ENV pnpm install --frozen-lockfile --prefer-offline)
fi

cd /workspace/apps/worker-api
# Keep Wrangler's awaited npm update check from turning a local D1 run into
# an external-network dependency. The cache shape is owned by update-check 1.x.
wrangler_version="$(node -p "require('./node_modules/wrangler/package.json').version")"
node -e '
  const fs = require("node:fs");
  const dir = "/tmp/update-check";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    `${dir}/wrangler-latest.json`,
    JSON.stringify({ latest: process.argv[1], lastUpdate: Date.now() }),
  );
' "$wrangler_version"
timeout 120 node_modules/.bin/wrangler d1 migrations apply DB --local --persist-to "$state"
setsid node_modules/.bin/wrangler dev \
  --local \
  --ip 127.0.0.1 \
  --port 8787 \
  --persist-to "$state" \
  --var ENVIRONMENT:development \
  --var CORS_ORIGIN:https://zero-vault-e2e.invalid \
  >"$wrangler_log" 2>&1 &
wrangler_pid=$!
for _ in $(seq 1 120); do
  kill -0 "$wrangler_pid"
  curl -fsS http://127.0.0.1:8787/ready | jq -e '.ok == true' >/dev/null && break
  sleep 1
done
curl -fsS http://127.0.0.1:8787/ready | jq -e '.ok == true' >/dev/null

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 \
  -subj /CN=Zero-Vault-E2E \
  -addext subjectAltName=IP:10.0.2.2,IP:127.0.0.1 \
  -keyout "$tls_key" -out "$tls_cert" >/dev/null 2>&1
chmod 600 "$tls_key" "$tls_cert"
setsid env \
  ZERO_VAULT_E2E_TLS_KEY="$tls_key" \
  ZERO_VAULT_E2E_TLS_CERT="$tls_cert" \
  ZERO_VAULT_E2E_FAIL_FIRST_ITEM_SYNC=0 \
  ZERO_VAULT_E2E_CONTROL_TOKEN="$control_token" \
  node /workspace/scripts/mobile-e2e-https-proxy.mjs >"$tls_proxy_log" 2>&1 &
tls_proxy_pid=$!
for _ in $(seq 1 120); do
  kill -0 "$tls_proxy_pid"
  curl --cacert "$tls_cert" -fsS https://127.0.0.1:8788/ready |
    jq -e '.ok == true' >/dev/null && break
  sleep 1
done
curl --cacert "$tls_cert" -fsS https://127.0.0.1:8788/ready |
  jq -e '.ok == true' >/dev/null

if adb devices | awk '$1 ~ /^emulator-/ { found=1 } END { exit !found }'; then
  echo "Another emulator is already running; refusing to touch another AVD." >&2
  exit 1
fi
if pgrep -f '[q]emu-system.*-avd' >/dev/null; then
  echo "An unregistered emulator process is already running; refusing to touch it." >&2
  exit 1
fi

dedicated_avds_owned=true
delete_dedicated_avd "$avd_a"
delete_dedicated_avd "$avd_b"
create_avd "$avd_a"
create_avd "$avd_b"

export EXPO_PUBLIC_ZERO_VAULT_API_URL=https://10.0.2.2:8788
cd /workspace/apps/mobile
pnpm exec expo prebuild --platform android --clean
mkdir -p android/app/src/debug/res/raw android/app/src/debug/res/xml
cp "$tls_cert" android/app/src/debug/res/raw/zero_vault_e2e_ca.pem
# Expo Dev Launcher fetches Metro over HTTP. This generated debug-only resource
# permits that local test transport; the personal release keeps cleartext off.
printf '%s\n' \
  '<?xml version="1.0" encoding="utf-8"?>' \
  '<network-security-config>' \
  '  <base-config cleartextTrafficPermitted="true">' \
  '    <trust-anchors>' \
  '      <certificates src="system" />' \
  '      <certificates src="@raw/zero_vault_e2e_ca" />' \
  '    </trust-anchors>' \
  '  </base-config>' \
  '</network-security-config>' \
  > android/app/src/debug/res/xml/zero_vault_network_security_config.xml
cd android
./gradlew :app:assembleDebug -PreactNativeArchitectures=x86_64
mapfile -t app_apks < <(find app/build/outputs/apk/debug -maxdepth 1 -type f -name '*.apk' -print)
test "${#app_apks[@]}" = 1
app_apk="${app_apks[0]}"
test -s "$app_apk"

setsid emulator \
  -avd "$avd_a" \
  -port 5554 \
  -wipe-data \
  -no-snapshot \
  -no-snapshot-save \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -gpu swiftshader_indirect \
  -accel on \
  >"$emulator_a_log" 2>&1 &
emulator_a_pid=$!
wait_for_device "$device_a"
setsid emulator \
  -avd "$avd_b" \
  -port 5556 \
  -wipe-data \
  -no-snapshot \
  -no-snapshot-save \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -gpu swiftshader_indirect \
  -accel on \
  >"$emulator_b_log" 2>&1 &
emulator_b_pid=$!
wait_for_device "$device_b"
test "$(adb -s "$device_a" emu avd name | head -1 | tr -d '\r')" = "$avd_a"
test "$(adb -s "$device_b" emu avd name | head -1 | tr -d '\r')" = "$avd_b"
adb -s "$device_a" install "$app_apk" | grep -q '^Success'
adb -s "$device_b" install "$app_apk" | grep -q '^Success'
adb devices -l > "$ARTIFACT_DIR/adb-devices.txt"
grep -q "^$device_a .*device" "$ARTIFACT_DIR/adb-devices.txt"
grep -q "^$device_b .*device" "$ARTIFACT_DIR/adb-devices.txt"

cd /workspace/apps/mobile
setsid env NODE_ENV=development CI=1 \
  EXPO_PUBLIC_ZERO_VAULT_API_URL=https://10.0.2.2:8788 \
  pnpm exec expo start --dev-client --localhost --port 8081 \
  >"$metro_log" 2>&1 &
metro_pid=$!
timeout 120 bash -c \
  'until curl -fsS http://127.0.0.1:8081/status | grep -q packager-status:running; do sleep 2; done'
adb -s "$device_a" reverse tcp:8081 tcp:8081
adb -s "$device_b" reverse tcp:8081 tcp:8081
adb -s "$device_a" reverse --list | grep -q 'tcp:8081 tcp:8081'
adb -s "$device_b" reverse --list | grep -q 'tcp:8081 tcp:8081'
adb -s "$device_a" shell cmd connectivity airplane-mode disable >/dev/null
adb -s "$device_b" shell cmd connectivity airplane-mode disable >/dev/null
printf '%s\n' \
  'metroHostStatus=passed' \
  'deviceAReverse8081=passed' \
  'deviceBReverse8081=passed' \
  >> "$ARTIFACT_DIR/two-device-stages.txt"

suffix="$(date -u +%s)-$RANDOM"
e2e_email="maestro-two-$suffix@example.invalid"
e2e_password="ZvTwo-$suffix-X9a!"
cd /workspace

run_sensitive_maestro "$device_a" a-bootstrap \
  apps/mobile/.maestro/two-device-a-bootstrap.yml \
  -e E2E_EMAIL="$e2e_email" \
  -e E2E_PASSWORD="$e2e_password"

recovery_hierarchy="$run_root/device-a-recovery.xml"
adb -s "$device_a" shell uiautomator dump /sdcard/zero-vault-recovery.xml >/dev/null
adb -s "$device_a" exec-out cat /sdcard/zero-vault-recovery.xml > "$recovery_hierarchy"
adb -s "$device_a" shell rm /sdcard/zero-vault-recovery.xml
e2e_recovery_code="$(node -e '
  const fs = require("node:fs");
  const source = fs.readFileSync(process.argv[1], "utf8");
  const node = source.match(/<node\b[^>]*resource-id="[^"]*recovery-code-value"[^>]*>/)?.[0];
  const code = node?.match(/text="([A-Za-z0-9_-]{43})"/)?.[1];
  if (!code) process.exit(1);
  process.stdout.write(code);
' "$recovery_hierarchy")"
rm -f "$recovery_hierarchy"
[[ "$e2e_recovery_code" =~ ^[A-Za-z0-9_-]{43}$ ]]
run_sensitive_maestro "$device_a" a-bootstrap-finish \
  apps/mobile/.maestro/two-device-a-bootstrap-finish.yml \
  -e E2E_PASSWORD="$e2e_password"

run_sensitive_maestro "$device_b" b-pending \
  apps/mobile/.maestro/two-device-b-pending.yml \
  -e E2E_EMAIL="$e2e_email" \
  -e E2E_PASSWORD="$e2e_password"

pending_hierarchy="$run_root/device-b-pending.xml"
adb -s "$device_b" shell uiautomator dump /sdcard/zero-vault-pending.xml >/dev/null
adb -s "$device_b" exec-out cat /sdcard/zero-vault-pending.xml > "$pending_hierarchy"
adb -s "$device_b" shell rm /sdcard/zero-vault-pending.xml
pending_fingerprint="$(node -e '
  const fs = require("node:fs");
  const source = fs.readFileSync(process.argv[1], "utf8");
  const match = source.match(/本机设备指纹：([0-9a-f]{64})/i);
  if (!match) process.exit(1);
  process.stdout.write(match[1].toLowerCase());
' "$pending_hierarchy")"
rm -f "$pending_hierarchy"
[[ "$pending_fingerprint" =~ ^[0-9a-f]{64}$ ]]

run_sensitive_maestro "$device_b" b-logout-pending \
  apps/mobile/.maestro/two-device-b-logout-pending.yml
run_sensitive_maestro "$device_a" a-approve \
  apps/mobile/.maestro/two-device-a-approve.yml \
  -e E2E_PASSWORD="$e2e_password" \
  -e PENDING_FINGERPRINT="$pending_fingerprint"

device_a_hierarchy="$run_root/device-a-devices.xml"
adb -s "$device_a" shell uiautomator dump /sdcard/zero-vault-devices.xml >/dev/null
adb -s "$device_a" exec-out cat /sdcard/zero-vault-devices.xml > "$device_a_hierarchy"
adb -s "$device_a" shell rm /sdcard/zero-vault-devices.xml
device_a_fingerprint="$(node -e '
  const fs = require("node:fs");
  const source = fs.readFileSync(process.argv[1], "utf8");
  const pending = process.argv[2].toLowerCase();
  const fingerprints = [...new Set(
    [...source.matchAll(/指纹：([0-9a-f]{64})/gi)].map((match) => match[1].toLowerCase()),
  )];
  if (fingerprints.length !== 2 || !fingerprints.includes(pending)) process.exit(1);
  const current = fingerprints.find((fingerprint) => fingerprint !== pending);
  if (!current || current === pending) process.exit(1);
  process.stdout.write(current);
' "$device_a_hierarchy" "$pending_fingerprint")"
rm -f "$device_a_hierarchy"
[[ "$device_a_fingerprint" =~ ^[0-9a-f]{64}$ ]]
test "$device_a_fingerprint" != "$pending_fingerprint"
printf '%s\n' 'a-device-fingerprint-distinct=passed' >> "$ARTIFACT_DIR/two-device-stages.txt"

run_sensitive_maestro "$device_a" a-return-vault \
  apps/mobile/.maestro/two-device-a-return-vault.yml \
  -e E2E_PASSWORD="$e2e_password"
run_sensitive_maestro "$device_b" b-approved-unlock \
  apps/mobile/.maestro/two-device-b-approved-unlock.yml \
  -e E2E_EMAIL="$e2e_email" \
  -e E2E_PASSWORD="$e2e_password"
unset pending_fingerprint device_a_fingerprint

run_conflict() {
  local label="$1"
  local title="$2"
  local resolution="$3"
  curl --cacert "$tls_cert" -fsS -X POST \
    -H "X-Zero-Vault-E2E-Control: $control_token" \
    https://127.0.0.1:8788/__zero_vault_e2e/fail-next-item-sync
  run_sensitive_maestro "$device_b" "b-$label-local" \
    apps/mobile/.maestro/two-device-b-edit-offline.yml \
    -e ITEM_TITLE="$title" \
    -e LOCAL_USERNAME="local-$label@example.invalid" \
    -e E2E_PASSWORD="$e2e_password"
  # The one-shot proxy failure has been consumed. Preserve B's queued local
  # mutation while A writes the competing server revision; keeping B stopped
  # prevents an automatic foreground sync from racing A's edit.
  adb -s "$device_b" shell am force-stop com.zerovault.mobile
  run_sensitive_maestro "$device_a" "a-$label-server" \
    apps/mobile/.maestro/two-device-a-edit-sync.yml \
    -e ITEM_TITLE="$title" \
    -e SERVER_USERNAME="server-$label@example.invalid" \
    -e E2E_PASSWORD="$e2e_password"
  run_sensitive_maestro "$device_b" "b-$label-resolve" \
    apps/mobile/.maestro/two-device-b-resolve.yml \
    -e CONFLICT_RESOLUTION="$resolution" \
    -e E2E_PASSWORD="$e2e_password"
}

run_conflict keep-local "Two Device Keep Local" local
run_sensitive_maestro "$device_b" b-keep-local-upload \
  apps/mobile/.maestro/two-device-b-sync-resolved.yml \
  -e E2E_PASSWORD="$e2e_password"
run_sensitive_maestro "$device_b" b-keep-local-final-value \
  apps/mobile/.maestro/two-device-b-assert-item.yml \
  -e E2E_PASSWORD="$e2e_password" \
  -e ITEM_TITLE="Two Device Keep Local" \
  -e EXPECTED_USERNAME="local-keep-local@example.invalid" \
  -e REJECTED_USERNAME="server-keep-local@example.invalid"
run_conflict accept-remote "Two Device Accept Remote" server
run_sensitive_maestro "$device_b" b-accept-remote-clean \
  apps/mobile/.maestro/two-device-b-sync-resolved.yml \
  -e E2E_PASSWORD="$e2e_password"
run_sensitive_maestro "$device_b" b-accept-remote-final-value \
  apps/mobile/.maestro/two-device-b-assert-item.yml \
  -e E2E_PASSWORD="$e2e_password" \
  -e ITEM_TITLE="Two Device Accept Remote" \
  -e EXPECTED_USERNAME="server-accept-remote@example.invalid" \
  -e REJECTED_USERNAME="local-accept-remote@example.invalid"
run_conflict keep-both "Two Device Keep Both" duplicate
run_sensitive_maestro "$device_b" b-keep-both-upload \
  apps/mobile/.maestro/two-device-b-sync-resolved.yml \
  -e E2E_PASSWORD="$e2e_password"
run_sensitive_maestro "$device_b" b-keep-both-final-values \
  apps/mobile/.maestro/two-device-b-assert-keep-both.yml \
  -e E2E_PASSWORD="$e2e_password"
run_conflict decide-later "Two Device Decide Later" skip
run_sensitive_maestro "$device_b" b-decide-later-reappears \
  apps/mobile/.maestro/two-device-b-skip-reappears.yml \
  -e E2E_PASSWORD="$e2e_password"
run_sensitive_maestro "$device_b" b-decide-later-clean \
  apps/mobile/.maestro/two-device-b-sync-resolved.yml \
  -e E2E_PASSWORD="$e2e_password"
run_sensitive_maestro "$device_b" b-decide-later-final-value \
  apps/mobile/.maestro/two-device-b-assert-item.yml \
  -e E2E_PASSWORD="$e2e_password" \
  -e ITEM_TITLE="Two Device Decide Later" \
  -e EXPECTED_USERNAME="server-decide-later@example.invalid" \
  -e REJECTED_USERNAME="local-decide-later@example.invalid"
run_sensitive_maestro "$device_a" a-delete-shared \
  apps/mobile/.maestro/two-device-a-delete-sync.yml \
  -e E2E_PASSWORD="$e2e_password" \
  -e ITEM_TITLE="Two Device Accept Remote"
run_sensitive_maestro "$device_b" b-receive-delete \
  apps/mobile/.maestro/two-device-b-assert-deleted.yml \
  -e E2E_PASSWORD="$e2e_password" \
  -e ITEM_TITLE="Two Device Accept Remote"
run_sensitive_maestro "$device_a" a-revoke-device-b \
  apps/mobile/.maestro/two-device-a-revoke.yml \
  -e E2E_PASSWORD="$e2e_password"
run_sensitive_maestro "$device_b" b-revoked-session \
  apps/mobile/.maestro/two-device-b-revoked-session.yml \
  -e E2E_PASSWORD="$e2e_password"
e2e_new_password="ZvRecover-$suffix-New!47Bb"
run_sensitive_maestro "$device_b" b-recovery-replacement \
  apps/mobile/.maestro/two-device-b-recover.yml \
  -e E2E_EMAIL="$e2e_email" \
  -e E2E_OLD_PASSWORD="$e2e_password" \
  -e E2E_NEW_PASSWORD="$e2e_new_password" \
  -e E2E_RECOVERY_CODE="$e2e_recovery_code"
run_sensitive_maestro "$device_a" a-recovery-invalidated \
  apps/mobile/.maestro/two-device-a-recovery-invalidated.yml \
  -e E2E_OLD_PASSWORD="$e2e_password"
unset e2e_email e2e_password e2e_new_password e2e_recovery_code

test -s "$metro_log"
remove_test_avds
test ! -e "/root/.android/avd/$avd_a.avd"
test ! -e "/root/.android/avd/$avd_a.ini"
test ! -e "/root/.android/avd/$avd_b.avd"
test ! -e "/root/.android/avd/$avd_b.ini"
rm -rf "$sensitive_output"
test ! -e "$sensitive_output"

printf '%s\n' \
  'api=36' \
  'independentAvds=passed' \
  'pendingDevice=passed' \
  'fingerprintComparedBeforeApproval=passed' \
  'deviceFingerprintsDistinct=passed' \
  'approvalAndVaultKeyPacketDecrypt=passed' \
  'deviceBUnlock=passed' \
  'sameRevisionConflictKeepLocal=passed' \
  'keepLocalFinalUsername=local-keep-local@example.invalid' \
  'sameRevisionConflictAcceptRemote=passed' \
  'acceptRemoteFinalUsername=server-accept-remote@example.invalid' \
  'sameRevisionConflictKeepBoth=passed' \
  'keepBothOriginal=Two Device Keep Both|server-keep-both@example.invalid' \
  'keepBothLocalCopy=Two Device Keep Both（本地副本）|local-keep-both@example.invalid' \
  'keepBothExactVisibleCount=2' \
  'sameRevisionConflictDecideLaterReappears=passed' \
  'decideLaterFinalUsername=server-decide-later@example.invalid' \
  'crossDeviceDeleteTombstone=passed' \
  'deviceBRevoked=passed' \
  'revokedBearerRejected=passed' \
  'revokedSessionCleared=passed' \
  'recoveryReplacementDevice=passed' \
  'recoveryOldApprovedDeviceInvalidated=passed' \
  'databaseOrWorkerStateInjection=false' \
  'dedicatedAvdConfigUserdataKeystoreRemoved=passed' \
  'sensitiveOutputRetained=false' \
  > "$ARTIFACT_DIR/two-device-golden.txt"

echo two-device-e2e-complete
