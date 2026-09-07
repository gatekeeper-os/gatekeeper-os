#!/usr/bin/env bash
# Phase 1 acceptance — runs INSIDE the VM from snapshot "base" via scripts/vm/test.sh phase-1.
# Criteria: docs/phase-checklist.md → Phase 1. Each check prints "PASS <id>" or "FAIL <id>"; the script exits non-zero on any FAIL.
set -uo pipefail
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; fails=$((fails+1)); }
check() { local id="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$id"; else fail "$id" "$*"; fi; }
t0=$(date +%s)
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# Fresh-host install from the synced working tree (equivalent to curl | bash with CLAWOS_FROM_SOURCE)
CLAWOS_FROM_SOURCE="$PWD" bash installer/install.sh >/tmp/install.log 2>&1 || fail install "see /tmp/install.log"
check status-healthy bash -c 'clawos status --json | jq -e ".healthy == true"'
check doctor-lint-clean openclaw doctor --lint --json
check security-audit-no-critical bash -c 'openclaw security audit --deep --json | jq -e "[.findings[]? | select(.severity==\"critical\")] | length == 0"'
check install-idempotent bash -c 'clawos install --cell default --yes --json | jq -e ".changed == false"'
check config-apply-idempotent bash -c 'clawos config apply --json | jq -e ".changed == false"'
check second-cell bash -c 'clawos cell create firmA --port 18801 --yes && clawos --cell firmA status --json | jq -e ".healthy == true"'
check backup-roundtrip bash -c 'a=$(clawos backup create --json | jq -r .archive) && clawos backup restore "$a" --yes'
check dropin-present grep -q OPENCLAW_NO_AUTO_UPDATE ~/.config/systemd/user/openclaw-gateway.service.d/clawos.conf
check perms bash -c '[ "$(stat -c %a ~/.openclaw/openclaw.json)" = 600 ] && [ "$(stat -c %a ~/.openclaw)" = 700 ] && [ "$(stat -c %a ~/.openclaw/os/cell.key)" = 600 ]'
elapsed=$(( $(date +%s) - t0 )); [ "$elapsed" -lt 600 ] && pass install-under-10min || fail install-under-10min "${elapsed}s"


echo "elapsed: $(( $(date +%s) - t0 ))s"
[ "$fails" -eq 0 ] && echo "phase-1: ALL PASS" || { echo "phase-1: $fails FAIL"; exit 1; }
