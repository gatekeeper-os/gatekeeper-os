#!/usr/bin/env bash
# Focused installer/policy acceptance in the dedicated VM, freshly restored by scripts/vm/test.sh.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export GKOS_CELL=default OPENCLAW_STATE_DIR=/home/tester/.openclaw OPENCLAW_CONFIG_PATH=/home/tester/.openclaw/openclaw.json OPENCLAW_NO_AUTO_UPDATE=1
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN
EV=/home/tester/phase-3-install-evidence
mkdir -p "$EV"
trap 'rc=$?; printf "%s\n" "$rc" > "$EV/install-exit-code"' EXIT
printf '%s\n' '{"mode":"install-integration","fullPhaseAcceptance":false,"liveSecondaryHookAcceptance":false,"realFilesystemWritesEnabled":false}' > "$EV/scope.json"
node --version > "$EV/node-version"
bash installer/install.sh > /home/tester/install-integration.log 2>&1
openclaw --version > "$EV/upstream-version"
gkos install --yes --json > "$EV/install-again.json" 2>/home/tester/install-again.stderr
jq -e '.changed == false and (.steps[] | select(.step == "plugins") | .state == "ok")' "$EV/install-again.json" >/dev/null
printf 'PASS install-idempotent\n'
gkos kernel status --json > /home/tester/installed-kernel-status.json 2>/home/tester/kernel-status.stderr
jq -e '.healthy == true and (.gatekeepers[] | select(.vendor == "fs") | .healthy == true)' /home/tester/installed-kernel-status.json >/dev/null
gkos grant list --json > /home/tester/installed-grants.json 2>/home/tester/grants.stderr
jq -e 'length == 0' /home/tester/installed-grants.json >/dev/null
printf 'PASS installed-kernel-fs-no-grants\n'
node test/scripts/install-scenarios.mjs > "$EV/scenarios.json"
export GKOS_KERNEL_VM=1 GKOS_SCENARIO_RUN="$GKOS_TEST_START" GKOS_SCENARIO_REPORT="$EV/scenarios.json"
pnpm --filter @gatekeeper-os/conformance... build
pnpm conformance --only install-gate --verdict "$EV/install-verdict.json"
pnpm --filter @gatekeeper-os/shared exec vitest run src/install-policy.test.ts --reporter=json --outputFile="$EV/policy-tests.json"
pnpm --filter @gatekeeper-os/cli exec vitest run --reporter=json --outputFile="$EV/cli-tests.json"
pnpm --filter @gatekeeper-os/kernel typecheck
pnpm --filter @gatekeeper-os/cli typecheck
pnpm check:catalog
pnpm check:secrets
printf 'installer-policy: PASS (focused checkpoint, not full Phase 3)\n'
