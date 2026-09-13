#!/usr/bin/env bash
# Restored VM only; structural provisioning/sandbox checkpoint, never a full driver acceptance surrogate.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export OPENCLAW_NO_AUTO_UPDATE=1
unset OPENCLAW_PROFILE OPENCLAW_STATE_DIR OPENCLAW_CONFIG_PATH OPENCLAW_GATEWAY_PORT OPENCLAW_GATEWAY_TOKEN GKOS_CELL
mode=${GKOS_TEST_MODE:-full}
evidence=/home/tester/phase-6-evidence
mkdir -p "$evidence"
if [ "$mode" = full ]; then
  printf '%s\n' '{"status":"blocked","fullPhaseAcceptance":false,"reasons":["accepted GitHub driver integration missing","HTTP driver deferred beyond beta"]}' > "$evidence/scope.json"
  echo 'BLOCKED full Phase 6 requires accepted driver integration'
  exit 2
fi
[ "$mode" = blueprint-sandbox ] || exit 2
printf '%s\n' '{"mode":"blueprint-sandbox","fullPhaseAcceptance":false,"model":"synthetic-local","realGateway":true,"realDocker":true,"baselineChanged":false,"fixturePolicyOverride":false,"cellPolicies":["runtime","messaging"],"missingDrivers":["github"],"plannedDrivers":["http"]}' > "$evidence/scope.json"
gateway_pid=''
cleanup(){ rc=$?; trap - EXIT; if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi; printf '%s\n' "$rc" > "$evidence/live-exit-code"; exit "$rc"; }
trap cleanup EXIT
pnpm install --frozen-lockfile --ignore-scripts > /home/tester/blueprint-deps.log 2>&1
pnpm build > /home/tester/blueprint-build.log 2>&1
mkdir -p /home/tester/blueprint-cli-package
cli_archive=$(node scripts/pack-cli.mjs /home/tester/blueprint-cli-package)
npm install -g --prefix /home/tester/phase-checkpoint-cli "$cli_archive" --ignore-scripts > /home/tester/blueprint-install.log 2>&1
export PATH="/home/tester/phase-checkpoint-cli/bin:$PATH"
node --version > "$evidence/node-version"
openclaw --version > "$evidence/upstream-version"
pnpm --filter @gatekeeper-os/cli exec vitest run src/commands/blueprint.test.ts --reporter=default --reporter=json --outputFile="$evidence/blueprint-tests.json"
# Setup the sandbox image via Docker in the VM only; no engine socket or host mounts enter the agent container.
if ! docker image inspect openclaw-sandbox:bookworm-slim >/dev/null 2>&1; then
  docker pull debian:bookworm-slim > /home/tester/blueprint-docker-pull.log 2>&1
  docker tag debian:bookworm-slim openclaw-sandbox:bookworm-slim
fi
for policy in runtime messaging; do
  export GKOS_BLUEPRINT_POLICY="$policy" GKOS_CELL="blueprint-$policy"
  export OPENCLAW_PROFILE="$GKOS_CELL" OPENCLAW_STATE_DIR="/home/tester/.openclaw-$GKOS_CELL"
  export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
  port=19100; [ "$policy" = runtime ] || port=19110
  export OPENCLAW_GATEWAY_PORT="$port"
  gkos cell create "$GKOS_CELL" --port "$port" --policy "$policy" --yes --json > "/home/tester/blueprint-create-$policy.log" 2>&1
  pnpm exec tsx test/scripts/blueprint-config.mjs
  gkos config apply --cell "$GKOS_CELL" --json > "/home/tester/blueprint-config-$policy.log" 2>&1
  systemctl --user stop "openclaw-gateway-$GKOS_CELL.service"
  openclaw config validate > "/home/tester/blueprint-validation-$policy.log" 2>&1
  openclaw gateway run > "/home/tester/blueprint-gateway-$policy.log" 2>&1 & gateway_pid=$!
  deadline=$((SECONDS+120))
  until curl -fsS --max-time 2 "http://127.0.0.1:$port/readyz" >/dev/null 2>&1; do
    if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS>=deadline)); then echo "FAIL blueprint-gateway-start-$policy"; exit 1; fi
    sleep 1
  done
  node test/scripts/blueprint-scenarios.mjs
  if [ "${GKOS_RELEASE_AUDIT:-0}" = 1 ]; then node test/scripts/release-blueprint-audit.mjs; fi
  kill "$gateway_pid"; wait "$gateway_pid" 2>/dev/null || true; gateway_pid=''
done
pnpm check:catalog
pnpm check:secrets
echo 'blueprint-sandbox: PASS (focused checkpoint, not full Phase 6 acceptance)'
