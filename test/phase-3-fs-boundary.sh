#!/usr/bin/env bash
# STOP 2 checkpoint only. Entry: scripts/vm/test.sh phase-3 installed fs-boundary.
set -euo pipefail
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
evidence="$HOME/phase-3-fs-boundary-evidence"
mkdir -p "$evidence"
printf '%s\n' '{"mode":"fs-boundary","fullPhaseAcceptance":false,"fileOperationsEnabled":false}' > "$evidence/scope.json"
trap 'rc=$?; printf "%s\n" "$rc" > "$evidence/boundary-exit-code"' EXIT
node --version > "$evidence/node-version"
node -e 'console.log(JSON.parse(require("fs").readFileSync("clawos.lock.json", "utf8")).upstream.version)' > "$evidence/upstream-pin"
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @clawos/gatekeeper-fs... build
pnpm --filter @clawos/gatekeeper-fs typecheck
pnpm --filter @clawos/gatekeeper-fs exec vitest run --reporter=default --reporter=json --outputFile="$evidence/fs-tests.json"
pnpm check:catalog
pnpm check:secrets
echo 'fs-boundary: PASS (not full Phase 3 acceptance; tools remain disabled)'
