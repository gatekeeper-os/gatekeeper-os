#!/usr/bin/env bash
# Phase 0 acceptance — runs INSIDE the VM from snapshot "base" via scripts/vm/test.sh phase-0.
# Criteria: docs/phase-checklist.md → Phase 0. Each check prints "PASS <id>" or "FAIL <id>"; the script exits non-zero on any FAIL.
set -uo pipefail
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; fails=$((fails+1)); }
check() { local id="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$id"; else fail "$id" "$*"; fi; }
t0=$(date +%s)
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# 1. Node + pinned upstream via installer pieces (no clawos install yet)
pin="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' clawos.lock.json | head -1)"
curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard >/tmp/upstream-install.log 2>&1 || fail node-provision "see /tmp/upstream-install.log"
hash -r; check node-present node --version
npm install -g "openclaw@$pin" --allow-scripts=openclaw >/tmp/npm.log 2>&1 || fail upstream-install "see /tmp/npm.log"
check upstream-version-matches-pin bash -c "openclaw --version | grep -q '$pin'"

# 2. Foreground gateway smoke (openclaw gateway run) with token auth and a dev profile
export OPENCLAW_PROFILE=clawos-spike OPENCLAW_GATEWAY_PORT=19100 OPENCLAW_GATEWAY_TOKEN=spike-token OPENCLAW_NO_AUTO_UPDATE=1
mkdir -p ~/.openclaw-clawos-spike && printf '{ gateway: { auth: { mode: "token", token: "spike-token" } } }' > ~/.openclaw-clawos-spike/openclaw.json && chmod 600 ~/.openclaw-clawos-spike/openclaw.json
(openclaw gateway run >/tmp/gw.log 2>&1 &) ; sleep 8
check gateway-readyz curl -fsS http://127.0.0.1:19100/readyz

# 3. Spike S-1: install the probe plugin and run its probes (records answers to plans/spike-S1.md on the host later)
openclaw plugins install ./scripts/spike-probe --force --accept-capabilities >/tmp/probe.log 2>&1 || fail probe-install "see /tmp/probe.log"
openclaw plugins inspect spike-probe --json > /tmp/probe-inspect.json 2>/dev/null && pass probe-inspect || fail probe-inspect
# TODO(phase-0): restart gateway, then exercise the probe's gateway method `os-spike.report` and save /tmp/spike-S1.json
#   (managed plugin root, unknown manifest key tolerance, $include root semantics, tool-name constraints,
#    toolCallId presence, late tool registration, manifest list access, gateway-method ctx fields, backup scope)
echo "spike-S1: see /tmp/probe-inspect.json and /tmp/spike-S1.json"
pkill -f 'openclaw gateway run' || true


echo "elapsed: $(( $(date +%s) - t0 ))s"
[ "$fails" -eq 0 ] && echo "phase-0: ALL PASS" || { echo "phase-0: $fails FAIL"; exit 1; }
