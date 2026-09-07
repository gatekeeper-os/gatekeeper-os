#!/usr/bin/env bash
# Greps the tree (and vm-artifacts if present) for token-like strings. Fails CI if any are found.
set -euo pipefail
patterns='(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|[0-9]{8,10}:[A-Za-z0-9_-]{35})'
if grep -rEn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude='check-secrets.sh' "$patterns" . ; then
  echo "check-secrets: token-like strings found (see above)" >&2
  exit 1
fi
echo "check-secrets: clean"
