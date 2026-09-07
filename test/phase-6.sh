#!/usr/bin/env bash
# Phase 6 acceptance — runs INSIDE the VM from snapshot "installed" via scripts/vm/test.sh phase-6.
# Criteria: docs/phase-checklist.md → Phase 6. Each check prints "PASS <id>" or "FAIL <id>"; the script exits non-zero on any FAIL.
set -uo pipefail
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; fails=$((fails+1)); }
check() { local id="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$id"; else fail "$id" "$*"; fi; }
t0=$(date +%s)
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

for b in assistant coder ops researcher; do
  clawos blueprint apply "$b" --agent "bp-$b" --yes >/tmp/bp-$b.log 2>&1 && pass "blueprint-$b" || fail "blueprint-$b" "see /tmp/bp-$b.log"
done
check blueprint-lint-negative bash -c '! clawos blueprint lint test/fixtures/bad-blueprint-exec-no-sandbox'
check blueprint-idempotent bash -c 'clawos blueprint apply coder --agent bp-coder --yes --json | jq -e ".changed == false"'
# TODO(phase-6): sandboxed exec with network none via a scripted turn


echo "elapsed: $(( $(date +%s) - t0 ))s"
[ "$fails" -eq 0 ] && echo "phase-6: ALL PASS" || { echo "phase-6: $fails FAIL"; exit 1; }
