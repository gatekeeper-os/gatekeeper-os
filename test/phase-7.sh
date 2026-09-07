#!/usr/bin/env bash
# Phase 7 acceptance — runs INSIDE the VM from snapshot "connected" via scripts/vm/test.sh phase-7.
# Criteria: docs/phase-checklist.md → Phase 7. Each check prints "PASS <id>" or "FAIL <id>"; the script exits non-zero on any FAIL.
set -uo pipefail
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; fails=$((fails+1)); }
check() { local id="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$id"; else fail "$id" "$*"; fi; }
t0=$(date +%s)
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

latest="$(npm view openclaw dist-tags.latest)"
clawos update --to "$latest" --yes >/tmp/update.log 2>&1 && pass update-pipeline || fail update-pipeline "see /tmp/update.log"
check version-after-update bash -c "openclaw --version | grep -q '$latest'"
check grants-intact bash -c 'clawos grant list --json | jq -e "length > 0"'
# TODO(phase-7): compat-block test (CLAWOS_TEST_FORCE_INCOMPAT=1), conformance-fail injection (CLAWOS_TEST_FAIL_CONFORMANCE=1),
#   kill during activate + `clawos rollback`, `clawos update --check` message


echo "elapsed: $(( $(date +%s) - t0 ))s"
[ "$fails" -eq 0 ] && echo "phase-7: ALL PASS" || { echo "phase-7: $fails FAIL"; exit 1; }
