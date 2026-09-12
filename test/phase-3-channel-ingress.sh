#!/usr/bin/env bash
# Real kernel/driver, actual agent turns and passive observation. Focused Phase 3 checkpoint.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export CLAWOS_KERNEL_VM=1 CLAWOS_CELL=kernel-test OPENCLAW_NO_AUTO_UPDATE=1
export OPENCLAW_STATE_DIR=/home/tester/.openclaw-kernel-test OPENCLAW_CONFIG_PATH=/home/tester/.openclaw-kernel-test/openclaw.json
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN
evidence=/home/tester/phase-3-channel-ingress-evidence
mkdir -p "$evidence"
export CLAWOS_SCENARIO_REPORT="$evidence/scenarios.json" CLAWOS_SCENARIO_RUN="$CLAWOS_TEST_START"
gateway_pid=''
cleanup(){ rc=$?; trap - EXIT; if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi; printf '%s\n' "$rc" > "$evidence/live-exit-code"; exit "$rc"; }
trap cleanup EXIT
printf '%s\n' '{"mode":"channel-ingress","realSlackAcceptance":false,"controlUiGatewayAcceptance":true,"fullPhaseAcceptance":false,"realFilesystemWritesEnabled":false}' > "$evidence/scope.json"
node --version > "$evidence/node-version"
pnpm install --frozen-lockfile --ignore-scripts > /home/tester/kernel-deps.log 2>&1
pnpm --filter @clawkeepers/kernel... --filter @clawkeepers/gatekeeper-fs... --filter @clawkeepers/conformance... --filter @clawkeepers/cli build > /home/tester/kernel-build.log 2>&1
mkdir -p /home/tester/kernel-cli-package
cli_archive=$(node scripts/pack-cli.mjs /home/tester/kernel-cli-package)
npm install -g --prefix /home/tester/phase-checkpoint-cli "$cli_archive" --ignore-scripts > /home/tester/kernel-cli-install.log 2>&1
export PATH="/home/tester/phase-checkpoint-cli/bin:$PATH"
pnpm --filter @clawkeepers/kernel typecheck
pnpm --filter @clawkeepers/kernel exec vitest run --reporter=default --reporter=json --outputFile="$evidence/kernel-tests.json"
pnpm --filter @clawkeepers/cli exec vitest run --reporter=default --reporter=json --outputFile="$evidence/cli-tests.json"
pnpm exec tsx test/scripts/channel-config.mjs
openclaw --version > "$evidence/upstream-version"
openclaw config validate > /home/tester/kernel-validation.log 2>&1
start_gateway(){
  openclaw gateway run > /home/tester/kernel-gateway.log 2>&1 & gateway_pid=$!
  deadline=$((SECONDS+120))
  until curl -fsS --max-time 2 http://127.0.0.1:19100/readyz >/dev/null 2>&1; do
    if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS>=deadline)); then echo 'FAIL kernel-gateway-start'; exit 1; fi
    sleep 1
  done
}
start_gateway
node test/scripts/channel-scenarios.mjs
pnpm check:catalog
pnpm check:secrets
echo 'channel-ingress: PASS (Control UI Gateway path + synthetic public SDK provider; real Slack transport remains separate)'
