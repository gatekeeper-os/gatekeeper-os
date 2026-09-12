#!/usr/bin/env bash
# Latest published release compatibility/reproduction, not a pin change or full acceptance.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] && [ "${CLAWOS_TEST_MODE:-}" = upstream-logging ] || exit 1
umask 077
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
# No OpenClaw invocation before the delegated fixture sets BOTH isolated state paths.
version=$(npm view openclaw dist-tags.latest)
[[ "$version" =~ ^2026\.[0-9]+\.[0-9]+$ ]] || { echo 'FAIL upstream-version-invalid'; exit 1; }
echo "Testing published OpenClaw $version; release pin unchanged"
npm install --prefix /home/tester/phase4-upstream "openclaw@$version" --ignore-scripts > /home/tester/github-upstream-install.log 2>&1
export CLAWOS_TEST_UPSTREAM_ROOT=/home/tester/phase4-upstream/node_modules/openclaw
export CLAWOS_TEST_MODE=gateway-integration
set +e
bash test/phase-4-gateway.sh
result=$?
set -e
node --input-type=module - "$version" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const path='/home/tester/phase-4-gateway-evidence/scope.json';
const scope=JSON.parse(readFileSync(path,'utf8'));
writeFileSync(path,JSON.stringify({...scope,mode:'upstream-logging',testedVersion:process.argv[2],pinChanged:false,fullPhaseAcceptance:false}),{mode:0o600});
JS
exit "$result"
