#!/usr/bin/env bash
# Restored VM only; structural provisioning/sandbox checkpoint, never a full driver acceptance surrogate.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export OPENCLAW_STATE_DIR=/home/tester/.openclaw-blueprint-test OPENCLAW_CONFIG_PATH=/home/tester/.openclaw-blueprint-test/openclaw.json
export CLAWOS_CELL=blueprint-test OPENCLAW_NO_AUTO_UPDATE=1
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN
mode=${CLAWOS_TEST_MODE:-full}
evidence=/home/tester/phase-6-evidence
mkdir -p "$evidence"
if [ "$mode" = full ]; then
  printf '%s\n' '{"status":"blocked","fullPhaseAcceptance":false,"reasons":["gatekeeper-http missing","accepted GitHub driver integration missing","global baseline denies coder/ops tools; explicit operator policy decision required"]}' > "$evidence/scope.json"
  echo 'BLOCKED full Phase 6 requires accepted drivers and explicit effective tool policy'
  exit 2
fi
[ "$mode" = blueprint-sandbox ] || exit 2
printf '%s\n' '{"mode":"blueprint-sandbox","fullPhaseAcceptance":false,"model":"synthetic-local","realGateway":true,"realDocker":true,"baselineChanged":false,"fixturePolicyOverride":true,"missingDrivers":["github","http"]}' > "$evidence/scope.json"
gateway_pid=''
cleanup(){ rc=$?; trap - EXIT; if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi; printf '%s\n' "$rc" > "$evidence/live-exit-code"; exit "$rc"; }
trap cleanup EXIT
pnpm install --frozen-lockfile --ignore-scripts > /home/tester/blueprint-deps.log 2>&1
pnpm build > /home/tester/blueprint-build.log 2>&1
mkdir -p /home/tester/blueprint-cli-package
pnpm --filter @clawkeepers/cli pack --pack-destination /home/tester/blueprint-cli-package > /home/tester/blueprint-pack.log 2>&1
npm install -g /home/tester/blueprint-cli-package/clawos-cli-0.1.0.tgz --ignore-scripts > /home/tester/blueprint-install.log 2>&1
node --version > "$evidence/node-version"
openclaw --version > "$evidence/upstream-version"
pnpm --filter @clawkeepers/cli exec vitest run src/commands/blueprint.test.ts --reporter=default --reporter=json --outputFile="$evidence/blueprint-tests.json"
pnpm exec tsx test/scripts/blueprint-config.mjs
openclaw config validate > /home/tester/blueprint-validation.log 2>&1
# Setup the sandbox image via Docker in the VM only; no engine socket or host mounts enter the agent container.
if ! docker image inspect openclaw-sandbox:bookworm-slim >/dev/null 2>&1; then
  docker pull debian:bookworm-slim > /home/tester/blueprint-docker-pull.log 2>&1
  docker tag debian:bookworm-slim openclaw-sandbox:bookworm-slim
fi
openclaw gateway run > /home/tester/blueprint-gateway.log 2>&1 & gateway_pid=$!
deadline=$((SECONDS+120))
until curl -fsS --max-time 2 http://127.0.0.1:19100/readyz >/dev/null 2>&1; do
  if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS>=deadline)); then echo 'FAIL blueprint-gateway-start'; exit 1; fi
  sleep 1
done
node test/scripts/blueprint-scenarios.mjs
pnpm check:catalog
pnpm check:secrets
echo 'blueprint-sandbox: PASS (focused checkpoint, not full Phase 6 acceptance)'
