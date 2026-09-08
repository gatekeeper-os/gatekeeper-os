#!/usr/bin/env bash
# Phase 3 acceptance — runs INSIDE the VM from snapshot "installed" via scripts/vm/test.sh phase-3.
# Criteria: docs/phase-checklist.md → Phase 3. Each check prints "PASS <id>" or "FAIL <id>"; the script exits non-zero on any FAIL.
set -uo pipefail
if [ "${CLAWOS_TEST_MODE:-full}" = conformance-runner ]; then
  exec bash test/phase-3-conformance-runner.sh
fi
if [ "${CLAWOS_TEST_MODE:-full}" = fs-enforcement ]; then
  exec bash test/phase-3-fs-enforcement.sh
fi
if [ "${CLAWOS_TEST_MODE:-full}" = fs-boundary ]; then
  exec bash test/phase-3-fs-boundary.sh
fi
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; fails=$((fails+1)); }
check() { local id="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$id"; else fail "$id" "$*"; fi; }
t0=$(date +%s)
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# Kernel + gatekeeper-fs from the tree, then the conformance subset
clawos dev install-plugins --from "$PWD" --yes >/tmp/plugins.log 2>&1 || fail install-plugins "see /tmp/plugins.log"
openclaw gateway restart && sleep 5
check plugins-enabled bash -c 'openclaw plugins list --json | jq -e "[.[] | select(.id==\"clawos-kernel\" or .id==\"gatekeeper-fs\") | select(.enabled)] | length == 2"'
pnpm conformance --only plugin-loads,hooks-fire,tool-narrowing,gate-blocks,rpc-methods,cli-mounted,health,fs-gatekeeper,install-gate --verdict ~/.openclaw/os/logs/conformance-verdict.json || fail conformance
# Scenario: operator introduces a directory by URL; non-operator cannot; revoke removes the tool; audit has every step
# TODO(phase-3): drive scripted turns with `openclaw agent` and a test provider; assert via `openclaw os audit query --json`.


echo "elapsed: $(( $(date +%s) - t0 ))s"
[ "$fails" -eq 0 ] && echo "phase-3: ALL PASS" || { echo "phase-3: $fails FAIL"; exit 1; }
