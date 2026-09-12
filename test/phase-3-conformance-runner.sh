#!/usr/bin/env bash
# Runner/SDK regression checkpoint; not live kernel acceptance.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || { echo 'Disposable test VM required'; exit 1; }
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
evidence="$HOME/phase-3-conformance-runner-evidence"
mkdir -p "$evidence"
trap 'rc=$?; printf "%s\n" "$rc" > "$evidence/runner-exit-code"' EXIT
printf '%s\n' '{"mode":"conformance-runner","fullPhaseAcceptance":false,"liveKernelAcceptance":false,"hostWritesEnabled":false}' > "$evidence/scope.json"
node --version > "$evidence/node-version"
node -e 'console.log(JSON.parse(require("fs").readFileSync("clawos.lock.json", "utf8")).upstream.version)' > "$evidence/upstream-pin"
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @clawkeepers/conformance... build
pnpm --filter @clawkeepers/conformance typecheck
pnpm --filter @clawkeepers/conformance exec vitest run --reporter=default --reporter=json --outputFile="$evidence/runner-tests.json"
# Real live suites must fail without evidence from a current isolated run.
# Skipped-suite refusal remains covered by the runner unit fixtures.
unset CLAWOS_KERNEL_VM CLAWOS_SCENARIO_RUN CLAWOS_SCENARIO_REPORT
set +e
pnpm conformance --only hooks-fire --verdict "$evidence/missing-evidence-verdict.json"
runner_rc=$?
set -e
[ "$runner_rc" -ne 0 ] || { echo 'FAIL missing live evidence accepted'; exit 1; }
node - "$evidence/missing-evidence-verdict.json" <<'NODE'
const fs = require('node:fs');
const v = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (v.ok !== false || !v.reasons.includes('ASSERTION_FAILED') || v.tests.length !== 1 || v.tests[0].id !== 'hooks-fire') process.exit(1);
NODE
# Existing installed guest Gateway only. No kernel plugin installation or config rewrite.
export OPENCLAW_STATE_DIR=/home/tester/.openclaw
export OPENCLAW_CONFIG_PATH=/home/tester/.openclaw/openclaw.json
export OPENCLAW_PROFILE=default
export CLAWOS_GATEWAY_URL=ws://127.0.0.1:18789
pnpm exec tsx test/scripts/conformance-transport.ts "$evidence/transport.json"
pnpm conformance --only health --verdict "$evidence/health-verdict.json"
pnpm check:catalog
pnpm check:secrets
echo 'conformance-runner: PASS (focused checkpoint; this mode does not exercise kernel enforcement)'
