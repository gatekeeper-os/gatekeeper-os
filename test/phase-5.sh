#!/usr/bin/env bash
# Disposable VM only. Synthetic provider/channel checkpoint is NOT full Phase5 acceptance.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export CLAWOS_KERNEL_VM=1 CLAWOS_CELL=kernel-test OPENCLAW_NO_AUTO_UPDATE=1
export OPENCLAW_STATE_DIR=/home/tester/.openclaw-kernel-test OPENCLAW_CONFIG_PATH=/home/tester/.openclaw-kernel-test/openclaw.json
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN
evidence=/home/tester/phase-5-evidence
mkdir -p "$evidence"
printf '%s\n' '{"fullPhaseAcceptance":false,"provider":"synthetic","channel":"local-synthetic","personalCredentials":false}' > "$evidence/scope.json"
if [ "${CLAWOS_TEST_MODE:-full}" != approvals-live ]; then
  printf '%s\n' '{"status":"blocked","reason":"Full acceptance requires accepted GitHub/log secrecy and a configured real operator channel"}' > "$evidence/verdict.json"
  echo 'BLOCKED full Phase5 acceptance'; exit 2
fi
export CLAWOS_SCENARIO_REPORT="$evidence/scenarios.json" CLAWOS_SCENARIO_RUN="$CLAWOS_TEST_START"
gateway_pid=''
cleanup(){ rc=$?; trap - EXIT; if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi; printf '%s\n' "$rc" > "$evidence/live-exit-code"; exit "$rc"; }
trap cleanup EXIT
node --version > "$evidence/node-version"
pnpm install --frozen-lockfile --ignore-scripts > /home/tester/phase5-deps.log 2>&1
pnpm --filter @clawkeepers/kernel... --filter @clawkeepers/gatekeeper-fs... --filter @clawkeepers/conformance... --filter @clawkeepers/cli build > /home/tester/phase5-build.log 2>&1
mkdir -p /home/tester/phase5-cli-package
pnpm --filter @clawkeepers/cli pack --pack-destination /home/tester/phase5-cli-package > /home/tester/phase5-pack.log 2>&1
npm install -g /home/tester/phase5-cli-package/clawos-cli-0.1.0.tgz --ignore-scripts > /home/tester/phase5-install.log 2>&1
pnpm exec tsx test/scripts/phase5-config.mjs
openclaw --version > "$evidence/upstream-version"
openclaw config validate > /home/tester/phase5-validation.log 2>&1
openclaw gateway run > /home/tester/phase5-gateway.log 2>&1 & gateway_pid=$!
deadline=$((SECONDS+120))
until curl -fsS --max-time 2 http://127.0.0.1:19100/readyz >/dev/null 2>&1; do
  if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS>=deadline)); then echo 'FAIL phase5-gateway-start'; exit 1; fi
  sleep 1
done
node test/scripts/phase5-scenarios.mjs
pnpm check:catalog
pnpm check:secrets
echo 'Phase5 approvals-live checkpoint passed; full phase acceptance remains blocked.'
