#!/usr/bin/env bash
# Registry-only product acceptance. Test fixtures are transferred by scripts/vm/test.sh.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/npm-acceptance ] || exit 1
[ ! -e /home/tester/src ] || exit 1
export PATH="/home/tester/npm-acceptance-prefix/bin:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
unset GKOS_FROM_SOURCE OPENCLAW_PROFILE OPENCLAW_STATE_DIR OPENCLAW_CONFIG_PATH OPENCLAW_GATEWAY_TOKEN OPENCLAW_GATEWAY_PORT GKOS_CELL GKOS_GATEKEEPER_CATALOG NODE_PATH
export OPENCLAW_NO_AUTO_UPDATE=1
evidence=/home/tester/npm-acceptance-evidence
mkdir -m 700 -p "$evidence"
stage=runtime-preflight gateway_pid=''
cleanup(){
  rc=$?; trap - EXIT
  if [ -n "$gateway_pid" ]; then kill "$gateway_pid" 2>/dev/null || true; wait "$gateway_pid" 2>/dev/null || true; fi
  systemctl --user stop openclaw-gateway-kernel-test.service >/dev/null 2>&1 || true
  printf '%s\n' "$rc" > "$evidence/live-exit-code"
  printf '%s\n' "$stage" > "$evidence/final-stage"
  if [ "$rc" -ne 0 ]; then printf 'FAIL npm-only stage=%s exit=%s; no product patch or retry\n' "$stage" "$rc"; fi
  exit "$rc"
}
trap cleanup EXIT
printf '%s\n' '{"mode":"npm-only","snapshot":"installed","repoClone":false,"productSourceBuild":false,"policy":"messaging","fullPhaseAcceptance":false,"realFilesystemWritesEnabled":false}' > "$evidence/scope.json"
# Provision the README-pinned engine in a test-only prefix. Never alter the
# snapshot's Node/upstream installation or reuse a source-built product.
node --version > "$evidence/guest-node-before"
[ "$(uname -sm)" = 'Linux x86_64' ]
runtime=/home/tester/npm-acceptance-runtime
mkdir -m 700 "$runtime"
archive=node-v22.22.3-linux-x64.tar.xz
curl -fsS --retry 2 "https://nodejs.org/dist/v22.22.3/$archive" -o "$runtime/$archive"
curl -fsS --retry 2 https://nodejs.org/dist/v22.22.3/SHASUMS256.txt -o "$runtime/SHASUMS256.txt"
(cd "$runtime" && grep -E "^[a-f0-9]{64}  $archive$" SHASUMS256.txt > selected.sha256 && sha256sum -c selected.sha256)
cp "$runtime/selected.sha256" "$evidence/guest-node-archive-sha256"
tar -xJf "$runtime/$archive" -C "$runtime"
export PATH="$runtime/node-v22.22.3-linux-x64/bin:$PATH"
node --version > "$evidence/guest-node-version"
test "$(cat "$evidence/guest-node-version")" = v22.22.3
node -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({version:process.version,executable:process.execPath,required:"v22.22.3",source:"https://nodejs.org/dist/v22.22.3/",archiveSHA256Verified:true},null,2)+"\n")' "$evidence/guest-runtime.json"
stage=registry-install
[ ! -e /home/tester/npm-acceptance-prefix ] || { echo "FAIL registry-prefix-not-empty"; exit 1; }
npm install --global --prefix /home/tester/npm-acceptance-prefix --ignore-scripts --registry=https://registry.npmjs.org \
  @gatekeeper-os/shared@0.1.0-beta.5 @gatekeeper-os/gatekeeper-kit@0.1.0-beta.5 \
  @gatekeeper-os/kernel@0.1.0-beta.5 @gatekeeper-os/gatekeeper-fs@0.1.0-beta.5 \
  @gatekeeper-os/cli@0.1.0-beta.5 > /home/tester/npm-only-install.log 2>&1
node registry.mjs
gkos --version > "$evidence/cli-version"
openclaw --version > "$evidence/upstream-version"
GKOS_UPSTREAM_PACKAGE_JSON=$(node -e 'const fs=require("fs"),p=require("path");process.stdout.write(p.join(p.dirname(fs.realpathSync(process.argv[1])),"package.json"));' "$(command -v openclaw)")
export GKOS_UPSTREAM_PACKAGE_JSON
stage=messaging-cell-create
gkos cell create kernel-test --port 19100 --policy messaging --yes --json > /home/tester/npm-only-create.log 2>&1
printf 'PASS registry-cli-messaging-cell-created\n'
export GKOS_KERNEL_VM=1 GKOS_CELL=kernel-test
export OPENCLAW_STATE_DIR=/home/tester/.openclaw-kernel-test OPENCLAW_CONFIG_PATH=/home/tester/.openclaw-kernel-test/openclaw.json
# Discover the chosen port from the product registry, not raw gateway.port.
OPENCLAW_GATEWAY_PORT=$(gkos cell list --json | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const rows=JSON.parse(s).filter(r=>r.name===process.env.GKOS_CELL);if(rows.length!==1)process.exit(1);process.stdout.write(String(rows[0].port));});')
export OPENCLAW_GATEWAY_PORT
node selector.mjs receipt
# Canonical cell-token SecretRef, not a competing OPENCLAW_GATEWAY_TOKEN override.
GKOS_GATEWAY_TOKEN=$(node -e 'const fs=require("fs");const s=fs.readFileSync(process.env.OPENCLAW_STATE_DIR+"/.env","utf8");const m=s.match(/^GKOS_GATEWAY_TOKEN=(.+)$/m);if(!m)process.exit(1);process.stdout.write(m[1]);')
export GKOS_GATEWAY_TOKEN
systemctl --user stop openclaw-gateway-kernel-test.service
stage=install-policy
node install-scenarios.mjs > "$evidence/install-scenarios.json"
# Explicit-cell reconciliation can restart its managed Gateway. The remaining
# scenarios own a foreground Gateway and must not inherit that service instance.
systemctl --user stop openclaw-gateway-kernel-test.service
printf 'PASS registry-cell-install-policy\n'
export GKOS_SCENARIO_REPORT="$evidence/scenarios.json" GKOS_SCENARIO_RUN="$GKOS_TEST_START"
start_gateway(){
  openclaw config validate > /home/tester/npm-only-validation.log 2>&1
  openclaw gateway run --port "$OPENCLAW_GATEWAY_PORT" > /home/tester/npm-only-gateway.log 2>&1 & gateway_pid=$!
  deadline=$((SECONDS+120))
  until curl -fsS --max-time 2 "http://127.0.0.1:$OPENCLAW_GATEWAY_PORT/readyz" >/dev/null 2>&1; do
    if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS>=deadline)); then echo 'FAIL npm-only-gateway-start'; exit 1; fi
    sleep 1
  done
}
stop_gateway(){ kill "$gateway_pid"; wait "$gateway_pid" 2>/dev/null || true; gateway_pid=''; }
# Remaining fixture invocations are defined with the reviewed test-only adapter.
stage=kernel-config
node config.mjs normal
start_gateway
stage=kernel-normal
node kernel-scenarios.mjs normal
stop_gateway
node config.mjs no-hooks
start_gateway
stage=kernel-no-hooks
node kernel-scenarios.mjs no-hooks
stop_gateway
stage=conformance
node conformance.mjs "$evidence/live-verdict.json"
stage=audience
node config.mjs owner
export GKOS_SCENARIO_REPORT="$evidence/audience-scenarios.json"
start_gateway
node channel-scenarios.mjs
stop_gateway
stage=approvals
export GKOS_SCENARIO_REPORT="$evidence/approval-scenarios.json"
node config.mjs approvals
start_gateway
node approval-scenarios.mjs
stop_gateway
stage=complete
printf 'npm-only: PASS (registry products, test-only fixtures; not full connected-provider acceptance)\n'
