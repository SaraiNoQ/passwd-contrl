#!/usr/bin/env bash
set -euo pipefail

REMOTE="root@campus-server"
REMOTE_SOURCE="/root/dev/zero-vault"
REMOTE_ARTIFACTS="/root/dev/zero-vault-artifacts"
REMOTE_LOCK="/root/dev/zero-vault-android.lock"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FINGERPRINT="$ROOT/scripts/mobile-source-fingerprint.sh"

if [[ -f "$ROOT/.npmrc" ]] && grep -Eiq '(_authToken|_password|username)[[:space:]]*=' "$ROOT/.npmrc"; then
  echo "Refusing to sync a root .npmrc containing inline registry credentials." >&2
  exit 1
fi

LOCK_ACQUIRED=false
LOCK_TOKEN="${MOBILE_REMOTE_LOCK_TOKEN:-}"
release_lock() {
  if [[ "$LOCK_ACQUIRED" == true && -n "$LOCK_TOKEN" ]]; then
    ssh "$REMOTE" "if [ \"\$(cat '$REMOTE_LOCK/owner' 2>/dev/null)\" = '$LOCK_TOKEN' ]; then rm -f '$REMOTE_LOCK/owner' && rmdir '$REMOTE_LOCK'; fi" >/dev/null 2>&1 || true
  fi
}
if [[ -n "$LOCK_TOKEN" ]]; then
  ssh "$REMOTE" "test \"\$(cat '$REMOTE_LOCK/owner' 2>/dev/null)\" = '$LOCK_TOKEN'" || {
    echo "Remote Android lock ownership could not be verified." >&2
    exit 1
  }
else
  LOCK_TOKEN="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM-$RANDOM"
  ssh "$REMOTE" "if mkdir '$REMOTE_LOCK'; then printf '%s\n' '$LOCK_TOKEN' > '$REMOTE_LOCK/owner' || { rmdir '$REMOTE_LOCK'; exit 1; }; else exit 1; fi" || {
    echo "Another Android sync/build owns $REMOTE_LOCK; refusing concurrent rsync." >&2
    exit 1
  }
  LOCK_ACQUIRED=true
  trap release_lock EXIT INT TERM
fi

ssh "$REMOTE" "if [ -e '$REMOTE_SOURCE' ] && [ -L '$REMOTE_SOURCE' ]; then echo 'Refusing symlinked remote source' >&2; exit 1; fi; mkdir -p '$REMOTE_SOURCE' '$REMOTE_ARTIFACTS'; test \"\$(readlink -f '$REMOTE_SOURCE')\" = '$REMOTE_SOURCE'"
ssh "$REMOTE" "find '$REMOTE_SOURCE' ! -path '*/node_modules/*' \( -type f -o -type l \) \( -name '.env' -o -name '.env.*' -o -name '*.env' -o -name '.dev.vars' -o -name '.dev.vars.*' -o -name '.npmrc' -o -name '.netrc' -o -name '.yarnrc' -o -name '.yarnrc.yml' -o -name 'credentials.toml' -o -name 'gradle.properties' -o -name 'local.properties' -o -name 'key.properties' -o -name 'keystore.properties' -o -name 'google-services.json' -o -name 'release.env' -o -name '*service-account*.json' -o -name '*.pk8' -o -name '*.jks' -o -name '*.keystore' -o -name '*.p12' -o -name '*.pfx' -o -name '*.pem' -o -name '*.key' -o -name 'recovery-codes.*' -o -name 'vault-export*' -o -name 'session-token*' \) ! -name '.env.example' -delete"
ssh "$REMOTE" "rm -rf '$REMOTE_SOURCE/apps/mobile/android' '$REMOTE_SOURCE/apps/mobile/ios'"

BEFORE_FINGERPRINT="$("$FINGERPRINT")"

rsync -az --checksum --delete-delay --stats \
  --include='.env.example' \
  --include='/.npmrc' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='*.env' \
  --exclude='.dev.vars' \
  --exclude='.dev.vars.*' \
  --exclude='.npmrc' \
  --exclude='.netrc' \
  --exclude='.yarnrc' \
  --exclude='.yarnrc.yml' \
  --exclude='.cargo/credentials' \
  --exclude='.cargo/credentials.toml' \
  --exclude='credentials.toml' \
  --exclude='gradle.properties' \
  --exclude='local.properties' \
  --exclude='key.properties' \
  --exclude='keystore.properties' \
  --exclude='google-services.json' \
  --exclude='release.env' \
  --exclude='*service-account*.json' \
  --exclude='.git/' \
  --exclude='.remote-sync' \
  --exclude='.DS_Store' \
  --exclude='.codegraph/' \
  --exclude='.claude/settings.local.json' \
  --exclude='.omo/' \
  --exclude='.playwright-mcp/' \
  --exclude='.wrangler/' \
  --exclude='node_modules/' \
  --exclude='*/node_modules/' \
  --exclude='.pnpm-store/' \
  --exclude='.next/' \
  --exclude='.expo/' \
  --exclude='.gradle/' \
  --exclude='*/.gradle/' \
  --exclude='target/' \
  --exclude='*/target/' \
  --exclude='build/' \
  --exclude='*/build/' \
  --exclude='dist/' \
  --exclude='*/dist/' \
  --exclude='out/' \
  --exclude='*/out/' \
  --exclude='apps/mobile/android/' \
  --exclude='apps/mobile/ios/' \
  --exclude='artifacts/' \
  --exclude='test-results/' \
  --exclude='coverage/' \
  --exclude='*.sqlite' \
  --exclude='*.sqlite3' \
  --exclude='*.sqlite-shm' \
  --exclude='*.sqlite-wal' \
  --exclude='*.db' \
  --exclude='*.csv' \
  --exclude='recovery-codes.*' \
  --exclude='vault-export*' \
  --exclude='session-token*' \
  --exclude='*.jks' \
  --exclude='*.keystore' \
  --exclude='*.pk8' \
  --exclude='*.p12' \
  --exclude='*.pfx' \
  --exclude='*.der' \
  --exclude='*.crt' \
  --exclude='*.pem' \
  --exclude='*.key' \
  --exclude='*.log' \
  "$ROOT/" "$REMOTE:$REMOTE_SOURCE/"

AFTER_FINGERPRINT="$("$FINGERPRINT")"
if [[ "$BEFORE_FINGERPRINT" != "$AFTER_FINGERPRINT" ]]; then
  echo "Local source changed during rsync; refusing a mixed snapshot." >&2
  exit 1
fi

COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
if [[ -z "$(git -C "$ROOT" status --porcelain)" ]]; then
  DIRTY=false
else
  DIRTY=true
fi
SYNCED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ssh "$REMOTE" "printf '%s\n' 'commit=$COMMIT' 'dirty=$DIRTY' 'fingerprint=$AFTER_FINGERPRINT' 'synced_at=$SYNCED_AT' > '$REMOTE_SOURCE/.remote-sync'"

echo "Synced $COMMIT (dirty=$DIRTY) to $REMOTE:$REMOTE_SOURCE"
