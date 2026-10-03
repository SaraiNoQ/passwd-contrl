#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
export LANG=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

snapshot="$(mktemp "${TMPDIR:-/tmp}/zero-vault-source-fingerprint.XXXXXX")"
trap 'rm -f "$snapshot"' EXIT

git rev-parse HEAD > "$snapshot"
git diff --binary --no-ext-diff HEAD >> "$snapshot"
while IFS= read -r -d '' file; do
  printf 'untracked:%s\n' "$file" >> "$snapshot"
  shasum -a 256 -- "$file" >> "$snapshot"
done < <(git ls-files --others --exclude-standard -z)

shasum -a 256 "$snapshot" | awk '{print $1}'
