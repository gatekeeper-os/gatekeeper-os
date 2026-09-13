#!/usr/bin/env bash
# Live secondary hook acceptance, always entered through scripts/vm/test.sh.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export GKOS_KERNEL_VM=1 GKOS_CELL=kernel-test OPENCLAW_NO_AUTO_UPDATE=1
export OPENCLAW_STATE_DIR=/home/tester/.openclaw-kernel-test OPENCLAW_CONFIG_PATH=/home/tester/.openclaw-kernel-test/openclaw.json
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN
EV=/home/tester/phase-3-install-hook-evidence
mkdir -p "$EV"
export GKOS_SCENARIO_REPORT="$EV/scenarios.json" GKOS_SCENARIO_RUN="$GKOS_TEST_START"
gateway_pid=''
cleanup(){ rc=$?; trap - EXIT; if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi; printf '%s\n' "$rc" > "$EV/hook-exit-code"; exit "$rc"; }
trap cleanup EXIT
printf '%s\n' '{"mode":"install-hook","fullPhaseAcceptance":false,"primaryRulesIndependentlyControlled":true,"realFilesystemWritesEnabled":false}' > "$EV/scope.json"
node --version > "$EV/node-version"
pnpm install --frozen-lockfile --ignore-scripts > /home/tester/install-hook-deps.log 2>&1
pnpm --filter @gatekeeper-os/kernel... --filter @gatekeeper-os/gatekeeper-fs... --filter @gatekeeper-os/conformance... build > /home/tester/install-hook-build.log 2>&1
pnpm exec tsup test/scripts/install-hook-primary.ts --format esm --target node22 --out-dir /home/tester/install-hook-build > /home/tester/install-hook-primary-build.log 2>&1
pnpm exec tsx test/scripts/kernel-config.mjs
node test/scripts/install-hook-config.mjs
python3 - <<'PY'
import zipfile
# Inert bytes used to exercise archive installation, not a reusable published skill.
with zipfile.ZipFile('/home/tester/install-hook-fixture.zip','w',zipfile.ZIP_DEFLATED) as archive:
 archive.writestr('SKILL.md','---\nname: gkos-hook-fixture\ndescription: Inert VM install acceptance fixture.\n---\nNo actions.\n')
PY
openclaw --version > "$EV/upstream-version"
start_gateway(){
  openclaw config validate > /home/tester/install-hook-validation.log 2>&1
  openclaw gateway run > /home/tester/install-hook-gateway.log 2>&1 & gateway_pid=$!
  deadline=$((SECONDS+120))
  until curl -fsS --max-time 2 http://127.0.0.1:19100/readyz >/dev/null 2>&1; do
    if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS>=deadline)); then echo 'FAIL install-hook-gateway-start'; exit 1; fi
    sleep 1
  done
}
start_gateway
node test/scripts/install-hook-scenarios.mjs deny
kill "$gateway_pid"; wait "$gateway_pid" || true; gateway_pid=''
node test/scripts/install-hook-config.mjs allow
start_gateway
node test/scripts/install-hook-scenarios.mjs allow
pnpm conformance --only install-hook --verdict "$EV/hook-verdict.json"
pnpm --filter @gatekeeper-os/kernel typecheck
pnpm --filter @gatekeeper-os/shared exec vitest run src/install-policy.test.ts --reporter=json --outputFile="$EV/policy-tests.json"
pnpm check:catalog
pnpm check:secrets
printf 'install-hook: PASS (focused checkpoint, not full Phase 3)\n'
