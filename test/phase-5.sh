#!/usr/bin/env bash
# Phase 5 acceptance — runs INSIDE the VM from snapshot "connected" via scripts/vm/test.sh phase-5.
# Criteria: docs/phase-checklist.md → Phase 5. Each check prints "PASS <id>" or "FAIL <id>"; the script exits non-zero on any FAIL.
set -uo pipefail
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; fails=$((fails+1)); }
check() { local id="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$id"; else fail "$id" "$*"; fi; }
t0=$(date +%s)
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# TODO(phase-5): auto-approval timing, drainer ordering, digest delivery, chat commands via a Telegram test bot
fail not-implemented "write Phase 5 checks"


echo "elapsed: $(( $(date +%s) - t0 ))s"
[ "$fails" -eq 0 ] && echo "phase-5: ALL PASS" || { echo "phase-5: $fails FAIL"; exit 1; }
