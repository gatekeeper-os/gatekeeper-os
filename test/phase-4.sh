#!/usr/bin/env bash
# Phase 4 acceptance — runs INSIDE the VM from snapshot "installed" via scripts/vm/test.sh phase-4.
# Criteria: docs/phase-checklist.md → Phase 4. Each check prints "PASS <id>" or "FAIL <id>"; the script exits non-zero on any FAIL.
set -uo pipefail
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; fails=$((fails+1)); }
check() { local id="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$id"; else fail "$id" "$*"; fi; }
t0=$(date +%s)
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

: "${GITHUB_TEST_TOKEN:?}" "${GITHUB_TEST_REPO:?}"
gkos dev install-plugins --from "$PWD" --yes >/tmp/plugins.log 2>&1 || fail install-plugins
gkos gatekeeper add github --client-id "${GITHUB_OAUTH_CLIENT_ID:-x}" --client-secret-env GITHUB_OAUTH_CLIENT_SECRET --yes || fail gk-add
gkos gatekeeper connect github --pat-env GITHUB_TEST_TOKEN --yes || fail gk-connect        # CI path; device flow tested manually
gkos grant add --agent home "https://github.com/$GITHUB_TEST_REPO" --json | jq -e .handle >/dev/null && pass grant-add || fail grant-add
pnpm conformance --only deferred-approval,require-approval-roundtrip --verdict ~/.openclaw/os/logs/conformance-verdict.json || fail conformance
# TODO(phase-4): comment→summarize scenario; approvals apply/reject/revert; secret-leak grep over ~/.openclaw/os and journal
check secret-leak-grep bash -c '! grep -rE "ghp_|github_pat_" ~/.openclaw/os/ 2>/dev/null'


echo "elapsed: $(( $(date +%s) - t0 ))s"
[ "$fails" -eq 0 ] && echo "phase-4: ALL PASS" || { echo "phase-4: $fails FAIL"; exit 1; }
