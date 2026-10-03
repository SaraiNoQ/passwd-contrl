#!/usr/bin/env bash
set -euo pipefail

: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"

avd=zero-vault-play-api36
image='system-images;android-36;google_apis_playstore;x86_64'
chrome_apk="$(mktemp /tmp/zero-vault-chrome.XXXXXX.apk)"
trap 'rm -f -- "$chrome_apk"' EXIT

sdkmanager --list_installed | grep -Fq "$image"
adb -e emu kill >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  if ! adb devices | awk '$1 ~ /^emulator-/ && $2 != "" { found=1 } END { exit !found }'; then
    break
  fi
  sleep 1
done
if adb devices | awk '$1 ~ /^emulator-/ && $2 != "" { found=1 } END { exit !found }'; then
  echo 'The previous emulator did not stop.' >&2
  exit 1
fi

test -f "/root/.android/avd/${avd}.avd/config.ini" ||
  echo no | avdmanager create avd --force --name "$avd" --package "$image" --device pixel_6
nohup emulator -avd "$avd" -wipe-data -no-snapshot -no-snapshot-save \
  -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -accel on \
  </dev/null >"$ARTIFACT_DIR/emulator.log" 2>&1 &

timeout 300 adb wait-for-device
timeout 300 bash -c 'until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r")" = 1 ]; do sleep 2; done'
test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = 36

adb shell pm path com.android.chrome | tr -d '\r' | tee "$ARTIFACT_DIR/chrome-package-paths.txt"
base_path="$(sed -n 's/^package://p' "$ARTIFACT_DIR/chrome-package-paths.txt" | head -1)"
case "$base_path" in /data/app/*.apk) ;; *) echo 'Unexpected Chrome APK path' >&2; exit 1 ;; esac
test -n "$base_path"
adb pull "$base_path" "$chrome_apk" >/dev/null
test -s "$chrome_apk"

"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose --print-certs "$chrome_apk" | tee "$ARTIFACT_DIR/chrome-signature.txt"
cert="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$ARTIFACT_DIR/chrome-signature.txt" | head -1 | tr -cd '0-9A-Fa-f' | tr '[:lower:]' '[:upper:]')"
test "${#cert}" = 64
version_name="$(adb shell dumpsys package com.android.chrome | sed -n 's/.*versionName=//p' | head -1 | tr -d '\r')"
version_code="$(adb shell dumpsys package com.android.chrome | sed -n 's/.*versionCode=\([0-9]*\).*/\1/p' | head -1 | tr -d '\r')"
test -n "$version_name"
test -n "$version_code"

jq -n \
  --arg cert "$cert" \
  '{apps:[{type:"android",info:{package_name:"com.android.chrome",signatures:[{build:"release",cert_fingerprint_sha256:$cert}]}}]}' \
  > "$ARTIFACT_DIR/privileged-callers-play-avd.json"
printf '%s\n' \
  'scope=api36-play-avd-only' \
  'packageName=com.android.chrome' \
  "versionName=$version_name" \
  "versionCode=$version_code" \
  "certificateSha256=$cert" \
  > "$ARTIFACT_DIR/chrome-version.txt"
sha256sum "$ARTIFACT_DIR/privileged-callers-play-avd.json" > "$ARTIFACT_DIR/privileged-callers-play-avd-SHA256"

echo browser-cert-api36-complete
