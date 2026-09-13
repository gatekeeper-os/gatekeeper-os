#!/usr/bin/env bash
# Focused STOP 2 implementation evidence, NOT full kernel/live acceptance.
set -euo pipefail
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
evidence="$HOME/phase-3-fs-enforcement-evidence"
mkdir -p "$evidence"
printf '%s\n' '{"mode":"fs-enforcement","fullPhaseAcceptance":false,"liveKernelAcceptance":false,"confinedReads":true,"persistentSimulation":true,"hostWritesEnabled":false}' > "$evidence/scope.json"
trap 'rc=$?; printf "%s\n" "$rc" > "$evidence/enforcement-exit-code"' EXIT
node --version > "$evidence/node-version"
node -e 'console.log(JSON.parse(require("fs").readFileSync("gkos.lock.json", "utf8")).upstream.version)' > "$evidence/upstream-pin"
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @gatekeeper-os/gatekeeper-fs... build
pnpm --filter @gatekeeper-os/gatekeeper-fs typecheck
pnpm --filter @gatekeeper-os/gatekeeper-fs exec vitest run --reporter=default --reporter=json --outputFile="$evidence/fs-tests.json"
pnpm check:catalog
pnpm check:secrets
echo 'fs-enforcement: PASS (focused only; all host-file application stays disabled)'
