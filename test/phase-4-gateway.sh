#!/usr/bin/env bash
# Real Gateway/kernel/driver with synthetic GitHub transport. Never full Phase 4.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
[ "${CLAWOS_TEST_MODE:-}" = gateway-integration ] || exit 1
umask 077
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export CLAWOS_KERNEL_VM=1 CLAWOS_CELL=kernel-test OPENCLAW_NO_AUTO_UPDATE=1
export OPENCLAW_STATE_DIR=/home/tester/.openclaw-kernel-test
export OPENCLAW_CONFIG_PATH=/home/tester/.openclaw-kernel-test/openclaw.json
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN GITHUB_TOKEN GH_TOKEN
export CLAWOS_TEST_APP_SECRET=offline-app-secret-marker
evidence=/home/tester/phase-4-gateway-evidence
mkdir -p "$evidence"
export CLAWOS_SCENARIO_REPORT="$evidence/scenarios.json" CLAWOS_SCENARIO_RUN="$CLAWOS_TEST_START"
gateway_pid=''
cleanup() {
  rc=$?; trap - EXIT
  if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi
  printf '%s\n' "$rc" > "$evidence/live-exit-code"
  exit "$rc"
}
trap cleanup EXIT
printf '%s\n' '{"mode":"gateway-integration","realProvider":false,"provider":"in-memory-fixture","fullPhaseAcceptance":false,"nativeApprovalRoundtrip":false}' > "$evidence/scope.json"
node --version > "$evidence/node-version"
pnpm install --frozen-lockfile --ignore-scripts > /home/tester/github-deps.log 2>&1
pnpm --filter @clawos/kernel... --filter @clawos/gatekeeper-github... --filter @clawos/cli --filter @clawos/conformance... build > /home/tester/github-build.log 2>&1
pnpm exec tsup test/fixtures/github-gateway/entry.ts --format esm --out-dir test/fixtures/github-gateway/dist --external 'openclaw/*' > /home/tester/github-fixture-build.log 2>&1
mkdir -p /home/tester/github-cli-package
pnpm --filter @clawos/cli pack --pack-destination /home/tester/github-cli-package > /home/tester/github-cli-pack.log 2>&1
npm install -g /home/tester/github-cli-package/clawos-cli-0.1.0.tgz --ignore-scripts > /home/tester/github-cli-install.log 2>&1
pnpm exec tsx test/scripts/github-config.mjs
openclaw --version > "$evidence/upstream-version"
openclaw config validate > /home/tester/github-validation.log 2>&1
openclaw gateway run > /home/tester/github-gateway.log 2>&1 & gateway_pid=$!
deadline=$((SECONDS+120))
until curl -fsS --max-time 2 http://127.0.0.1:19100/readyz >/dev/null 2>&1; do
  if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS>=deadline)); then echo 'FAIL github-gateway-start'; exit 1; fi
  sleep 1
done
node test/scripts/github-scenarios.mjs
pnpm check:catalog
pnpm check:secrets
echo 'phase-4 gateway-integration: PASS (synthetic provider; NOT live GitHub or full Phase 4 acceptance)'
