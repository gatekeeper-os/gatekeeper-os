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
pnpm --filter @clawos/conformance... build
pnpm --filter @clawos/conformance typecheck
pnpm --filter @clawos/conformance exec vitest run --reporter=default --reporter=json --outputFile="$evidence/runner-tests.json"
# The currently unimplemented live suite must fail, even though Vitest exits zero for it.skip.
set +e
pnpm conformance --only hooks-fire --verdict "$evidence/skipped-verdict.json"
runner_rc=$?
set -e
[ "$runner_rc" -ne 0 ] || { echo 'FAIL skipped suite accepted'; exit 1; }
node - "$evidence/skipped-verdict.json" <<'NODE'
const fs = require('node:fs');
const v = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (v.ok !== false || !v.reasons.includes('ASSERTION_NOT_RUN') || v.tests.length !== 1 || v.tests[0].id !== 'hooks-fire') process.exit(1);
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
echo 'conformance-runner: PASS (focused checkpoint; kernel enforcement remains unverified)'
