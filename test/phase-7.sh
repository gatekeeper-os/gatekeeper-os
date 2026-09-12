#!/usr/bin/env bash
# Reset-VM runtime checkpoint; no connected credential snapshot and no full-conformance waiver.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
if [ "${CLAWOS_TEST_MODE:-full}" != runtime-checkpoint ]; then
  mkdir -p /home/tester/phase-7-evidence
  printf '%s\n' '{"mode":"full","blocked":true,"fullPhaseAcceptance":false,"reason":"Full Phase 4/5/6 live conformance is not accepted"}' > /home/tester/phase-7-evidence/scope.json
  printf '2\n' > /home/tester/phase-7-evidence/runtime-exit-code
  echo 'BLOCKED: full Phase 7 requires accepted Phase 4/5/6 live conformance'
  exit 2
fi
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export CLAWOS_CELL=default OPENCLAW_STATE_DIR=/home/tester/.openclaw OPENCLAW_CONFIG_PATH=/home/tester/.openclaw/openclaw.json OPENCLAW_NO_AUTO_UPDATE=1
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN
EV=/home/tester/phase-7-evidence
mkdir -p "$EV"
printf '%s\n' '{"mode":"runtime-checkpoint","snapshot":"installed","fullPhaseAcceptance":false,"fullConformance":false,"personalCredentials":false}' > "$EV/scope.json"
trap 'rc=$?; printf "%s\n" "$rc" > "$EV/runtime-exit-code"' EXIT
node --version > "$EV/node-version"
bash installer/install.sh > /home/tester/phase7-install.log 2>&1
printf 'PASS install-current-kernel\n'
mkdir -p /home/tester/update-resource
node --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
writeFileSync('/home/tester/.openclaw/os/config.d/90-local.json5',JSON.stringify({plugins:{entries:{'gatekeeper-fs':{config:{roots:['/home/tester/update-resource']}}}}}),{mode:0o600});
JS
clawos config apply > /home/tester/phase7-config.log 2>&1
clawos grant add --agent main file:///home/tester/update-resource/ --json > /home/tester/phase7-grant.json 2>/home/tester/phase7-grant.stderr
printf 'PASS real-filesystem-grant\n'
clawos update --check --json > "$EV/availability.json"
printf 'PASS availability-check\n'
pnpm exec tsx test/scripts/update-compat.ts > /home/tester/phase7-compat.log 2>&1
printf 'PASS incompatible-plugin-rejected-at-step-two\n'
pnpm exec tsx test/scripts/update-runtime.ts reject > /home/tester/phase7-reject.log 2>&1
printf 'PASS conformance-rejection-before-maintenance\n'
pnpm exec tsx test/scripts/update-runtime.ts success > /home/tester/phase7-success.log 2>&1
printf 'PASS nine-step-runtime-update\n'
pnpm exec tsx test/scripts/update-runtime.ts recover > /home/tester/phase7-rollback.log 2>&1
cp "$EV/recovery.json" "$EV/success-rollback.json"
printf 'PASS explicit-rollback-grants-preserved\n'
set +e
pnpm exec tsx test/scripts/update-runtime.ts interrupt > /home/tester/phase7-interrupt.log 2>&1
rc=$?
set -e
[ "$rc" -ne 0 ] || exit 1
pnpm exec tsx test/scripts/update-runtime.ts recover > /home/tester/phase7-recovery.log 2>&1
printf 'PASS interrupted-activation-recovery\n'
clawos kernel status --json | jq '{healthy,kernelSchema,activeRuns,activeEffects,maintenance}' > "$EV/final-status.json"
jq -e '.healthy and .kernelSchema == 1 and .maintenance == false' "$EV/final-status.json" >/dev/null
printf 'PASS final-kernel-healthy\n'
