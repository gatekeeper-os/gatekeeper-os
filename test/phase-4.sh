#!/usr/bin/env bash
# Full VM runner. Credentials arrive privately; production OAuth is never seeded.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
[ "${CLAWOS_TEST_MODE:-}" = full ] || exit 1
umask 077
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export CLAWOS_KERNEL_VM=1 CLAWOS_CELL=kernel-test OPENCLAW_NO_AUTO_UPDATE=1
export OPENCLAW_STATE_DIR=/home/tester/.openclaw-kernel-test
export OPENCLAW_CONFIG_PATH=/home/tester/.openclaw-kernel-test/openclaw.json
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN GITHUB_TOKEN GH_TOKEN
# The host may deliver this via the protected environment or the private JSON
# envelope consumed by the host-owned launcher. Never source arbitrary shell text.
evidence=/home/tester/phase-4-evidence
mkdir -p "$evidence"
export CLAWOS_SCENARIO_REPORT="$evidence/scenarios.json" CLAWOS_SCENARIO_RUN="${CLAWOS_TEST_START:?Current VM run required}"
gateway_pid=''
cleanup() {
  rc=$?; trap - EXIT
  if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi
  printf '%s\n' "$rc" > "$evidence/live-exit-code"
  node --input-type=module - "$rc" <<'JS'
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
for (const path of ['/home/tester/phase-4-evidence/scope.json', process.env.CLAWOS_SCENARIO_REPORT]) {
  if (!existsSync(path)) continue;
  const value = JSON.parse(readFileSync(path, 'utf8'));
  value.fullPhaseAcceptance = process.argv[2] === '0' && value.fullPhaseAcceptance === true;
  if (process.argv[2] !== '0' && value.status === 'passed') value.status = 'failed';
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
JS
  exit "$rc"
}
trap cleanup EXIT
printf '%s\n' '{"mode":"full","status":"running","fullPhaseAcceptance":false,"realProvider":true,"provider":"github.com"}' > "$evidence/scope.json"
if [ ! -r /run/user/1000/clawos-phase4-input.json ] || [ -z "${CLAWOS_TEST_APP_SECRET:-}" ]; then
  printf '%s\n' '{"mode":"full","status":"blocked","fullPhaseAcceptance":false,"realProvider":false,"blockers":["protected-real-github-oauth-input-required"]}' > "$evidence/scope.json"
  echo 'BLOCKED phase-4: protected real GitHub OAuth input required.'
  exit 2
fi
node --version > "$evidence/node-version"
pnpm install --frozen-lockfile --ignore-scripts > /home/tester/github-real-deps.log 2>&1
pnpm --filter @clawos/kernel... --filter @clawos/gatekeeper-github... --filter @clawos/cli --filter @clawos/conformance... build > /home/tester/github-real-build.log 2>&1
pnpm exec tsx test/scripts/github-real-config.mjs
openclaw --version > "$evidence/upstream-version"
start_gateway() {
  openclaw config validate > "/home/tester/github-real-$1-validation.log" 2>&1
  openclaw gateway run > "/home/tester/github-real-$1-gateway.log" 2>&1 & gateway_pid=$!
  local deadline=$((SECONDS+120))
  until curl -fsS --max-time 2 http://127.0.0.1:19100/readyz >/dev/null 2>&1; do
    if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS>=deadline)); then echo 'FAIL real-github-gateway-start'; exit 1; fi
    sleep 1
  done
}
stop_gateway() { kill "$gateway_pid"; wait "$gateway_pid" || true; gateway_pid=''; }
start_gateway deferred
deferred_rc=0
pnpm exec tsx test/scripts/github-real-scenarios.mjs || deferred_rc=$?
stop_gateway
if [ "$deferred_rc" -ne 0 ]; then
  node test/scripts/github-real-log-secrecy.mjs || true
  exit "$deferred_rc"
fi
pnpm exec tsx test/scripts/github-real-config.mjs native
start_gateway native
scenario_rc=0
pnpm exec tsx test/scripts/github-real-scenarios.mjs native || scenario_rc=$?
stop_gateway
scan_rc=0
node test/scripts/github-real-log-secrecy.mjs || scan_rc=$?
[ "$scenario_rc" -eq 0 ] && [ "$scan_rc" -eq 0 ] || exit 1
(cd packages/clawos-conformance && CLAWOS_CONFORMANCE_ONLY=deferred-approval,require-approval-roundtrip \
  pnpm exec vitest run --workspace conformance.workspace.ts --reporter=json --outputFile="$evidence/conformance.json")
pnpm check:catalog
pnpm check:secrets
echo 'phase-4 full: PASS (real GitHub OAuth, independent effects, native approvals and log secrecy)'
