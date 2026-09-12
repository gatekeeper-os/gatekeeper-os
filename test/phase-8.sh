#!/usr/bin/env bash
# Approved STOP2 observations plus disposable synthetic deferred fixture; no native effects.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
evidence=/home/tester/phase-8-boundary-evidence
mkdir -p "$evidence"
if [ "${CLAWOS_TEST_MODE:-full}" != mcp-boundary ]; then
  printf '%s\n' '{"status":"blocked","fullPhaseAcceptance":false,"reason":"Real provider and native log-secrecy acceptance outstanding"}' > "$evidence/scope.json"
  exit 2
fi
export CLAWOS_KERNEL_VM=1 OPENCLAW_NO_AUTO_UPDATE=1
export OPENCLAW_STATE_DIR=/home/tester/.openclaw-kernel-test OPENCLAW_CONFIG_PATH=/home/tester/.openclaw-kernel-test/openclaw.json
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN
node --version > "$evidence/node-version"
printf '%s\n' '{"mode":"mcp-boundary","fullPhaseAcceptance":false,"realProviderAcceptance":false,"observationsEnabled":true,"nativeExecutionEnabled":false,"syntheticDeferredFixture":true}' > "$evidence/scope.json"
gateway_pid=''
cleanup(){ rc=$?; trap - EXIT; if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi; printf '%s\n' "$rc" > "$evidence/exit-code"; exit "$rc"; }
trap cleanup EXIT
pnpm install --frozen-lockfile --ignore-scripts > /home/tester/mcp-deps.log 2>&1
pnpm build > /home/tester/mcp-build.log 2>&1
pnpm --filter @clawos/gatekeeper-mcp typecheck
pnpm --filter @clawos/gatekeeper-mcp exec vitest run --reporter=default --reporter=json --outputFile="$evidence/mcp-tests.json"
pnpm exec tsx test/scripts/kernel-config.mjs
pnpm exec tsx test/scripts/mcp-boundary-config.mjs
openclaw --version > "$evidence/upstream-version"
openclaw config validate > /home/tester/mcp-validation.log 2>&1
start_gateway(){
openclaw gateway run > "/home/tester/mcp-${1}-gateway.log" 2>&1 & gateway_pid=$!
deadline=$((SECONDS+120))
until curl -fsS --max-time 2 http://127.0.0.1:19100/readyz >/dev/null 2>&1; do
  if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS>=deadline)); then echo 'FAIL mcp-gateway-start'; exit 1; fi
  sleep 1
done
}
start_gateway boundary
node test/scripts/mcp-boundary-scenarios.mjs
kill "$gateway_pid"; wait "$gateway_pid" || true; gateway_pid=''
ln -s ../../../packages/gatekeeper-mcp/node_modules test/fixtures/mcp-notes/node_modules
pnpm exec tsup test/fixtures/mcp-notes/index.ts --format esm --out-dir test/fixtures/mcp-notes/dist --external @clawos/gatekeeper-kit --external typebox > /home/tester/mcp-fixture-build.log 2>&1
pnpm exec tsx test/scripts/mcp-boundary-config.mjs fixture
openclaw config validate > /home/tester/mcp-fixture-validation.log 2>&1
start_gateway fixture
node test/scripts/mcp-notes-scenarios.mjs
kill "$gateway_pid"; wait "$gateway_pid" || true; gateway_pid=''
# Known blocked native suite is never executed or disguised as acceptance.
printf '%s\n' '{"deferredEvidence":"deferred.json","nativeRoundtrip":"blocked-upstream-logging","fullConformance":false}' > "$evidence/conformance-scope.json"
node test/scripts/mcp-secrecy-scan.mjs
pnpm check:catalog
pnpm check:secrets
echo 'MCP observation/deferred fixture: PASS (not full acceptance)'
