#!/usr/bin/env bash
# Collect evidence from the VM into an artifact directory and fail if any token-like string is present.
# Usage: collect.sh <outdir> <start-iso-ts>
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
out="${1:?outdir}"; since="${2:-1 hour ago}"
grab() { local name="$1"; shift; vm_call exec "$*" > "$out/$name" 2>&1 || true; }
if [ "${3:-}:${4:-}" = phase-3:fs-boundary ]; then
  # Account/resource tests only: no Gateway/config/credential collection at this checkpoint.
  vm_call pull /home/tester/phase-3-fs-boundary-evidence/ "$out/" || exit 1
elif [ "${3:-}" = phase-0 ]; then
  vm_call pull /home/tester/phase-0-evidence/ "$out/" || exit 1
elif [ "${3:-}" = phase-1 ]; then
  # Allowlisted structural evidence only: the per-check JSON the phase script wrote, plus service state. The raw
  # `openclaw.json` and the cell `.env` are never collected — those are the two files that hold credentials.
  vm_call pull /home/tester/phase-1-evidence/ "$out/" || exit 1
  if [ "$DRIVER" != github-hosted ]; then
    grab systemd-status.txt 'systemctl --user status "openclaw-gateway*" --no-pager'
    grab journal.txt        "journalctl --user -u 'openclaw-gateway*' --since '$since' --no-pager"
  fi
else
grab openclaw-version.txt        'openclaw --version'
grab plugins.json                'openclaw plugins list --json'
grab doctor-lint.json            'openclaw doctor --lint --json'
grab security-audit.json         'openclaw security audit --deep --json'
grab os-status.json              'openclaw os status --json'
grab systemd-status.txt          'systemctl --user status "openclaw-gateway*" --no-pager'
grab journal.txt                 "journalctl --user -u 'openclaw-gateway*' --since '$since' --no-pager"
grab audit-log.jsonl             'cat ~/.openclaw/os/audit/*.jsonl 2>/dev/null'
grab conformance-verdict.json    'cat ~/.openclaw/os/logs/conformance-verdict.json 2>/dev/null'
grab lockfile.json               'cat ~/.openclaw/os/clawos.lock.json 2>/dev/null'
fi
if grep -rEq '(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-|[0-9]{8,10}:[A-Za-z0-9_-]{35})' "$out"; then
  vm_log "SECRET-LIKE STRING FOUND IN ARTIFACTS — run marked failed"; echo 99 > "$out/exit-code"; exit 99
fi
