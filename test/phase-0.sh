#!/usr/bin/env bash
# VM-only S-1 acceptance. The host wrapper resets base and syncs before invoking this.
set -euo pipefail
[ "$(id -un)" = tester ] && . /etc/os-release && [ "$ID:$VERSION_ID" = ubuntu:24.04 ] || { echo 'FAIL test-vm-required'; exit 1; }
export CLAWOS_SPIKE_VM=1 OPENCLAW_STATE_DIR=/home/tester/clawos-spike-state
export OPENCLAW_CONFIG_PATH=/home/tester/clawos-spike-state/openclaw.json OPENCLAW_NO_AUTO_UPDATE=1
unset OPENCLAW_PROFILE
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
mkdir -p /home/tester/phase-0-evidence
chmod 700 /home/tester/phase-0-evidence
pin=$(python3 -c 'import json; print(json.load(open("clawos.lock.json"))["upstream"]["version"])')
# This installer provisions Node and installs exactly the dev pin; it never runs on the host.
curl -fsSL https://openclaw.ai/install.sh -o /home/tester/upstream-install.sh
if ! bash /home/tester/upstream-install.sh --no-onboard --no-prompt --version "$pin" > /home/tester/upstream-install.log 2>&1; then echo 'FAIL upstream-install (guest log: /home/tester/upstream-install.log)'; exit 1; fi
hash -r
node --version
actual=$(openclaw --version)
printf '%s\n' "$actual" > /home/tester/phase-0-evidence/openclaw-version.txt
[[ "$actual" == *"$pin"* ]] || { echo 'FAIL upstream-version'; exit 1; }
echo 'PASS pinned-upstream-installed'
if ! command -v pnpm >/dev/null; then npm install -g pnpm@10.15.0 > /home/tester/pnpm-install.log 2>&1; fi
pnpm install --frozen-lockfile > /home/tester/pnpm-install-workspace.log 2>&1
pnpm --filter spike-probe build > /home/tester/probe-build.log 2>&1
node scripts/spike-config.mjs
openclaw config validate > /home/tester/config-validation.log 2>&1
node scripts/spike-model.mjs > /home/tester/model.log 2>&1 & model_pid=$!
openclaw gateway run > /home/tester/gateway.log 2>&1 & gateway_pid=$!
cleanup() { kill "$gateway_pid" "$model_pid" 2>/dev/null || true; wait "$gateway_pid" "$model_pid" 2>/dev/null || true; }
trap cleanup EXIT
deadline=$((SECONDS+120))
until curl -fsS http://127.0.0.1:19100/readyz >/dev/null 2>&1; do
  if ! kill -0 "$gateway_pid" 2>/dev/null || ((SECONDS >= deadline)); then echo 'FAIL gateway-start (guest log: /home/tester/gateway.log)'; exit 1; fi
  sleep 1
done
echo 'PASS foreground-gateway-ready'
openclaw gateway call os-spike.report --json > /home/tester/phase-0-evidence/spike-initial.json 2>/home/tester/rpc.log
for n in $(seq 1 20); do
  openclaw agent --agent main --session-id "spike-turn-$n" --message 'Run the available probe once.' --json > /home/tester/turn-result.json 2>/home/tester/turn-error.log || { echo "FAIL scripted-turn-$n"; exit 1; }
  echo "PASS scripted-turn-$n"
done
openclaw gateway call os-spike.report --json > /home/tester/phase-0-evidence/spike-final.json 2>/home/tester/rpc.log
cp "$OPENCLAW_STATE_DIR/os/spike-S1.jsonl" /home/tester/phase-0-evidence/
cp "$OPENCLAW_STATE_DIR/os/model-tools.jsonl" /home/tester/phase-0-evidence/

# Policy accepts only structural, protocol-versioned results. No model traffic needed.
for mode in block malformed allow; do
  node scripts/spike-policy-config.mjs "$mode"
  openclaw config validate > /home/tester/policy-validation.log 2>&1
  if openclaw plugins install ./test/fixtures/install-policy-probe --force --accept-capabilities > /home/tester/policy-install.log 2>&1; then
    [ "$mode" = allow ] || { echo "FAIL install-policy-$mode-allowed"; exit 1; }
  else
    [ "$mode" != allow ] || { echo 'FAIL install-policy-allow'; exit 1; }
  fi
  echo "PASS install-policy-$mode"
done
cp "$OPENCLAW_STATE_DIR/os/install-policy.jsonl" /home/tester/phase-0-evidence/
node scripts/spike-assert.mjs
