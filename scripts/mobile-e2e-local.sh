#!/usr/bin/env bash
set -euo pipefail

: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"
: "${ANDROID_HOME:?ANDROID_HOME is required}"

e2e_scope="${ZERO_VAULT_E2E_SCOPE:-all}"
case "$e2e_scope" in
  all|system|editor-layout|recovery) ;;
  *) echo "ZERO_VAULT_E2E_SCOPE must be all, system, editor-layout, or recovery" >&2; exit 2 ;;
esac
fail_first_item_sync=1
[[ "$e2e_scope" == all ]] || fail_first_item_sync=0

run_root="$(mktemp -d /tmp/zero-vault-e2e-local.XXXXXX)"
state="$run_root/wrangler-state"
wrangler_log="$run_root/wrangler.log"
tls_proxy_log="$run_root/tls-proxy.log"
tls_key="$run_root/e2e.key"
tls_cert="$run_root/e2e.crt"
sensitive_output="$run_root/sensitive"
wrangler_pid=""
tls_proxy_pid=""
metro_pid=""
finger_pid=""
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

cleanup() {
  set +e
  stop_group "$finger_pid"
  stop_group "$metro_pid"
  stop_group "$tls_proxy_pid"
  stop_group "$wrangler_pid"
  [[ -f "$wrangler_log" ]] && cp "$wrangler_log" "$ARTIFACT_DIR/wrangler.log"
  [[ -f "$tls_proxy_log" ]] && cp "$tls_proxy_log" "$ARTIFACT_DIR/tls-proxy.log"
  case "$run_root" in
    /tmp/zero-vault-e2e-local.*) [[ -d "$run_root" ]] && rm -rf -- "$run_root" ;;
  esac
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
  local label="$1"
  local flow="$2"
  shift 2
  local flow_output="$sensitive_output/$label"

  mkdir -m 700 "$flow_output"
  if maestro test \
    "$@" \
    --format junit \
    --output "$flow_output/junit.xml" \
    --test-output-dir "$flow_output/output" \
    "$flow" \
    >"$flow_output/console.log" 2>&1 &&
    test -s "$flow_output/junit.xml"; then
    return 0
  fi

  write_sanitized_maestro_status \
    "$flow_output/output" \
    "$ARTIFACT_DIR/maestro-$label-command-status.json" || true
  echo "$label E2E failed; raw sensitive output was destroyed." >&2
  return 1
}

start_finger_loop() {
  setsid bash -c '
    while :; do
      adb -e emu finger touch 1 >/dev/null 2>&1 || true
      sleep 0.35
      adb -e emu finger remove >/dev/null 2>&1 || true
      sleep 0.35
    done
  ' &
  finger_pid=$!
}

kill_app_process_for_cold_start() {
  local package_name="$1"
  local process_ids
  local process_id

  # Maestro can already have torn down the React Native process when a setup
  # flow ends. Process death is the desired precondition, so make this helper
  # idempotent instead of treating an already-dead process as a harness error.
  process_ids="$(adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' || true)"
  for process_id in $process_ids; do
    [[ "$process_id" =~ ^[0-9]+$ ]]
    adb shell kill -9 "$process_id"
  done
  timeout 30 bash -c \
    'until ! adb shell pidof "$1" >/dev/null 2>&1; do sleep 1; done' \
    _ "$package_name"
}

start_tls_proxy() {
  setsid env \
    ZERO_VAULT_E2E_TLS_KEY="$tls_key" \
    ZERO_VAULT_E2E_TLS_CERT="$tls_cert" \
    ZERO_VAULT_E2E_FAIL_FIRST_ITEM_SYNC="$fail_first_item_sync" \
    ZERO_VAULT_E2E_CONTROL_TOKEN="$control_token" \
    node /workspace/scripts/mobile-e2e-https-proxy.mjs >>"$tls_proxy_log" 2>&1 &
  tls_proxy_pid=$!

  for _ in $(seq 1 120); do
    kill -0 "$tls_proxy_pid"
    if curl --cacert "$tls_cert" -fsS https://127.0.0.1:8788/ready | jq -e '.ok == true' >/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "Local E2E HTTPS proxy did not become ready" >&2
  return 1
}

unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
export CI=1 WRANGLER_SEND_METRICS=false NO_UPDATE_NOTIFIER=1
mkdir -m 700 "$state"

command -v maestro >/dev/null
command -v openssl >/dev/null
control_token="$(openssl rand -hex 32)"
[[ "$control_token" =~ ^[0-9a-f]{64}$ ]]
command -v apkanalyzer >/dev/null
test -x "$ANDROID_HOME/build-tools/36.0.0/apksigner"
if [[ ! -x /workspace/apps/worker-api/node_modules/.bin/wrangler ||
      ! -x /workspace/apps/mobile/node_modules/.bin/expo ]]; then
  (cd /workspace && env -u NODE_ENV pnpm install --frozen-lockfile --prefer-offline)
fi
test -x /workspace/apps/worker-api/node_modules/.bin/wrangler
test -x /workspace/apps/mobile/node_modules/.bin/expo

cd /workspace/apps/worker-api
# Wrangler 3 awaits its npm update check before local D1 commands. Prime the
# package's one-hour cache with the installed version so this isolated harness
# never waits for a registry or retries a closed loopback URL.
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
  if curl -fsS http://127.0.0.1:8787/ready | jq -e '.ok == true' >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8787/ready | jq -e '.ok == true' >/dev/null

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 \
  -subj /CN=Zero-Vault-E2E \
  -addext subjectAltName=IP:10.0.2.2,IP:127.0.0.1 \
  -keyout "$tls_key" -out "$tls_cert" >/dev/null 2>&1
chmod 600 "$tls_key" "$tls_cert"
> "$tls_proxy_log"
start_tls_proxy
curl --cacert "$tls_cert" -fsS https://127.0.0.1:8788/ready | jq -e '.ok == true' >/dev/null
api_url="https://10.0.2.2:8788"
printf '%s\n' \
  'freshLocalD1=true' \
  'cloudflareCredentialsUsed=false' \
  'ephemeralDebugCa=true' \
  'oneShotItemSyncNetworkFailure=true' \
  'apiHost=10.0.2.2:8788' \
  > "$ARTIFACT_DIR/e2e-environment.txt"

export EXPO_PUBLIC_ZERO_VAULT_API_URL="$api_url"
export ZERO_VAULT_E2E_CONFIRM_DESTRUCTIVE=YES

timeout 240 adb wait-for-device
timeout 240 bash -c 'until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" = 1 ]; do sleep 2; done'
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 36
cp /tmp/zero-vault-emulator-api36.log "$ARTIFACT_DIR/emulator.log"

cd /workspace/apps/mobile
pnpm exec expo prebuild --platform android --clean
printf '%s\n' \
  "include ':zero-vault-autofill-fixture'" \
  "project(':zero-vault-autofill-fixture').projectDir = new File(rootDir, '../../../infra/android/autofill-fixture')" \
  >> android/settings.gradle
mkdir -p android/app/src/debug/res/raw android/app/src/debug/res/xml
cp "$tls_cert" android/app/src/debug/res/raw/zero_vault_e2e_ca.pem
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
./gradlew \
  :zero-vault-autofill-fixture:clean \
  :app:installDebug \
  :zero-vault-autofill-fixture:assembleDebug
timeout 30 adb wait-for-device
test "$(adb get-state | tr -d '\r')" = device
test "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1
adb shell pm path com.zerovault.mobile | tee "$ARTIFACT_DIR/installed-package.txt"
grep -q '^package:' "$ARTIFACT_DIR/installed-package.txt"
adb shell cmd package resolve-activity \
  --brief \
  -c android.intent.category.LAUNCHER \
  com.zerovault.mobile \
  > "$ARTIFACT_DIR/launcher-activity.txt"
grep -q '^com\.zerovault\.mobile/' "$ARTIFACT_DIR/launcher-activity.txt"

fixture_output_dir=/workspace/infra/android/autofill-fixture/build/outputs/apk/debug
mapfile -t fixture_apks < <(find "$fixture_output_dir" -maxdepth 1 -type f -name '*.apk' -print)
test "${#fixture_apks[@]}" = 1
fixture_apk="${fixture_apks[0]}"
test -s "$fixture_apk"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$fixture_apk" \
  | tee "$ARTIFACT_DIR/autofill-fixture-apk-signature.txt"
mapfile -t fixture_signer_lines < <(
  grep -E '^Signer #[0-9]+ certificate SHA-256 digest: ' \
    "$ARTIFACT_DIR/autofill-fixture-apk-signature.txt"
)
test "${#fixture_signer_lines[@]}" = 1
fixture_certificate="$(
  printf '%s\n' "${fixture_signer_lines[0]#*: }" \
    | tr -cd '0-9A-Fa-f' \
    | tr '[:lower:]' '[:upper:]'
)"
[[ "$fixture_certificate" =~ ^[0-9A-F]{64}$ ]]
test "$(apkanalyzer manifest application-id "$fixture_apk")" = com.zerovault.autofillfixture
test "$(apkanalyzer manifest min-sdk "$fixture_apk")" = 26
test "$(apkanalyzer manifest target-sdk "$fixture_apk")" = 36
test "$(apkanalyzer manifest debuggable "$fixture_apk")" = true
printf '%s\n' \
  'applicationId=com.zerovault.autofillfixture' \
  'minSdk=26' \
  'targetSdk=36' \
  'debuggable=true' \
  > "$ARTIFACT_DIR/autofill-fixture-manifest.txt"
jq -n --arg certificate "$fixture_certificate" \
  '{packageName:"com.zerovault.autofillfixture",signingCertificateSha256:$certificate}' \
  > "$ARTIFACT_DIR/autofill-fixture-android-association.json"
adb install -r "$fixture_apk" | tee "$ARTIFACT_DIR/autofill-fixture-install.txt"
grep -q '^Success' "$ARTIFACT_DIR/autofill-fixture-install.txt"
adb shell pm path com.zerovault.autofillfixture \
  | tee "$ARTIFACT_DIR/autofill-fixture-installed-package.txt"
grep -q '^package:' "$ARTIFACT_DIR/autofill-fixture-installed-package.txt"

cd /workspace/apps/mobile
setsid env NODE_ENV=development CI=1 EXPO_PUBLIC_ZERO_VAULT_API_URL="$api_url" \
  pnpm exec expo start --dev-client --localhost --port 8081 \
  > "$ARTIFACT_DIR/metro.log" 2>&1 &
metro_pid=$!
timeout 120 bash -c 'until curl -fsS http://127.0.0.1:8081/status | grep -q packager-status:running; do sleep 2; done'
adb reverse tcp:8081 tcp:8081
adb shell cmd connectivity airplane-mode disable >/dev/null

cd /workspace
mkdir -p "$ARTIFACT_DIR/maestro-output"
mkdir -m 700 "$sensitive_output"
if [[ "$e2e_scope" == editor-layout ]]; then
  run_sensitive_maestro \
    editor-layout-api36 \
    apps/mobile/.maestro/editor-layout-api36.yml
  adb exec-out screencap -p > "$ARTIFACT_DIR/editor-layout-api36.png"
  test -s "$ARTIFACT_DIR/editor-layout-api36.png"
  adb shell uiautomator dump /sdcard/editor-layout-api36.xml >/dev/null
  adb pull /sdcard/editor-layout-api36.xml "$ARTIFACT_DIR/editor-layout-api36.xml" >/dev/null
  test -s "$ARTIFACT_DIR/editor-layout-api36.xml"
  printf '%s\n' \
    'api=36' \
    'scope=editor-layout' \
    'newCredentialEditor=passed' \
    > "$ARTIFACT_DIR/e2e-scope.txt"
  test -s "$ARTIFACT_DIR/metro.log"
  echo editor-layout-e2e-complete
  exit 0
fi

maestro test \
  --format junit \
  --output "$ARTIFACT_DIR/maestro-junit.xml" \
  --test-output-dir "$ARTIFACT_DIR/maestro-output/smoke" \
  apps/mobile/.maestro/smoke.yml
test -s "$ARTIFACT_DIR/maestro-junit.xml"

if [[ "$e2e_scope" == recovery || "$e2e_scope" == all ]]; then
  run_sensitive_maestro \
    recovery-client \
    apps/mobile/.maestro/recovery-client.yml
  printf '%s\n' \
    'api=36' \
    'scope=recovery' \
    'nativeRecovery=passed' \
    > "$ARTIFACT_DIR/recovery-scope.txt"
  if [[ "$e2e_scope" == recovery ]]; then
    test -s "$ARTIFACT_DIR/metro.log"
    echo recovery-e2e-complete
    exit 0
  fi
fi

if [[ "$e2e_scope" == all ]]; then
  offline_suffix="$(date -u +%s)-$RANDOM"
  offline_email="maestro-offline-${offline_suffix}@example.invalid"
  offline_password="Zv-${offline_suffix}-Old-29Aa"

  run_sensitive_maestro \
    production-client \
    apps/mobile/.maestro/production-client.yml

  one_shot_failure_count="$(
    grep -c '^e2e-one-shot-item-sync-network-failure production$' "$tls_proxy_log" || true
  )"
  test "$one_shot_failure_count" = 1

  run_sensitive_maestro \
    offline-restart-register \
    apps/mobile/.maestro/offline-restart-register.yml \
    -e OFFLINE_EMAIL="$offline_email" \
    -e OFFLINE_PASSWORD="$offline_password"

  offline_item_sync_before="$(
    grep -c '^e2e-item-sync-upstream POST 200$' "$tls_proxy_log" || true
  )"
  curl --cacert "$tls_cert" -fsS -X POST \
    -H "X-Zero-Vault-E2E-Control: $control_token" \
    https://127.0.0.1:8788/__zero_vault_e2e/fail-next-item-sync
  test "$(
    grep -c '^e2e-item-sync-failure-armed offline-restart$' "$tls_proxy_log" || true
  )" = 1

  run_sensitive_maestro \
    offline-restart-prepare \
    apps/mobile/.maestro/offline-restart-prepare.yml \
    -e OFFLINE_EMAIL="$offline_email" \
    -e OFFLINE_PASSWORD="$offline_password"

  test "$(
    grep -c '^e2e-one-shot-item-sync-network-failure offline-restart$' "$tls_proxy_log" || true
  )" = 1

  run_sensitive_maestro \
    offline-restart-resume \
    apps/mobile/.maestro/offline-restart-resume.yml \
    -e OFFLINE_EMAIL="$offline_email" \
    -e OFFLINE_PASSWORD="$offline_password"

  offline_item_sync_after="$(
    grep -c '^e2e-item-sync-upstream POST 200$' "$tls_proxy_log" || true
  )"
  test "$offline_item_sync_after" -eq "$((offline_item_sync_before + 1))"
  printf '%s\n' \
    'productionItemSyncNetworkFailure=observed-once' \
    'offlineRestartItemSyncNetworkFailure=observed-once' \
    "offlineItemSyncPushesBeforeRestart=$offline_item_sync_before" \
    "offlineItemSyncPushesAfterRestart=$offline_item_sync_after" \
    > "$ARTIFACT_DIR/business-network-evidence.txt"

  printf '%s\n' \
    'api=36' \
    'productionClient=passed' \
    'offlineProcessRestart=passed' \
    > "$ARTIFACT_DIR/business-golden.txt"
else
  printf '%s\n' \
    'api=36' \
    'scope=system' \
    'businessFlows=skipped' \
    > "$ARTIFACT_DIR/e2e-scope.txt"
fi

device_locale="$(adb shell getprop persist.sys.locale | tr -d '\r')"
if [[ -z "$device_locale" ]]; then
  device_locale="$(adb shell getprop ro.product.locale | tr -d '\r')"
fi
test "$device_locale" = en-US
printf '%s\n' 'locale=en-US' > "$ARTIFACT_DIR/api36-locale.txt"

adb root >"$ARTIFACT_DIR/adb-root.txt"
adb wait-for-device
adb shell id | grep -q '^uid=0(root)'
# Restarting adbd as root clears reverse-port state on the API 36 emulator.
# Restore Metro before the post-enrollment dev-client account setup.
adb reverse tcp:8081 tcp:8081
adb reverse --list | tee "$ARTIFACT_DIR/adb-reverse-after-root.txt"
grep -q 'tcp:8081 tcp:8081' "$ARTIFACT_DIR/adb-reverse-after-root.txt"

device_pin=684219
start_finger_loop
adb shell am start -W \
  -a android.settings.BIOMETRIC_ENROLL \
  --ei android.provider.extra.BIOMETRIC_AUTHENTICATORS_ALLOWED 15 \
  >"$sensitive_output/biometric-enroll-start.txt" 2>&1
run_sensitive_maestro \
  biometric-enroll-api36 \
  apps/mobile/.maestro/biometric-enroll-api36.yml \
  -e DEVICE_PIN="$device_pin"
unset device_pin

# Finger events are only needed for enrollment and BiometricPrompt. Leaving the
# loop active while the app creates its ordinary Keystore alias and opens the
# first vault session makes the API 36 fixture race unrelated biometric events.
stop_group "$finger_pid"
finger_pid=""

run_sensitive_maestro \
  autofill-account-setup-api36 \
  apps/mobile/.maestro/autofill-account-setup-api36.yml \
  -e FIXTURE_PACKAGE=com.zerovault.autofillfixture \
  -e FIXTURE_CERT="$fixture_certificate"

start_finger_loop
run_sensitive_maestro \
  autofill-provider-setup-api36 \
  apps/mobile/.maestro/autofill-provider-setup-api36.yml

adb shell am start -W -n com.zerovault.autofillfixture/.MainActivity >/dev/null
kill_app_process_for_cold_start com.zerovault.mobile
run_sensitive_maestro \
  autofill-fixture-api36 \
  apps/mobile/.maestro/autofill-fixture-api36.yml

adb shell am start -W -n com.zerovault.autofillfixture/.MainActivity >/dev/null
kill_app_process_for_cold_start com.zerovault.mobile
run_sensitive_maestro \
  credential-provider-fixture-api36 \
  apps/mobile/.maestro/credential-provider-fixture-api36.yml

printf '%s\n' \
  'api=36' \
  'fixturePackage=com.zerovault.autofillfixture' \
  'singleSigner=passed' \
  'biometricStrongEnrollment=passed' \
  'autofillAfterRnProcessDeath=passed' \
  'credentialProviderAfterRnProcessDeath=passed' \
  > "$ARTIFACT_DIR/autofill-credential-golden.txt"

test -s "$ARTIFACT_DIR/metro.log"
echo e2e-local-complete
