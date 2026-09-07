#!/usr/bin/env bash
# Collect evidence from the VM into an artifact directory and fail if any token-like string is present.
# Usage: collect.sh <outdir> <start-iso-ts>
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
out="${1:?outdir}"; since="${2:-1 hour ago}"
grab() { local name="$1"; shift; vm_call exec "$*" > "$out/$name" 2>&1 || true; }
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
if bash "$REPO_ROOT/scripts/check-secrets.sh" >/dev/null 2>&1; then :; fi
if grep -rEq '(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-|[0-9]{8,10}:[A-Za-z0-9_-]{35})' "$out"; then
  vm_log "SECRET-LIKE STRING FOUND IN ARTIFACTS — run marked failed"; echo 99 > "$out/exit-code"; exit 99
fi
