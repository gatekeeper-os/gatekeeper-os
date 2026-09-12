#!/usr/bin/env bash
# Greps the tree (and vm-artifacts if present) for token-like strings. Fails CI if any are found.
set -euo pipefail
patterns='(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----|[0-9]{8,10}:[A-Za-z0-9_-]{35})'
status=0
grep -rEl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.state --exclude='secrets.env' --exclude='check-secrets.sh' "$patterns" . || status=$?
case "$status" in
  0) echo "check-secrets: token-like strings found in listed files (values withheld)" >&2; exit 1 ;;
  1) echo "check-secrets: clean" ;;
  *) echo "check-secrets: scan incomplete; refusing a clean verdict" >&2; exit "$status" ;;
esac
