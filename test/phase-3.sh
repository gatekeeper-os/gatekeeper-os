#!/usr/bin/env bash
# Phase 3 acceptance — runs INSIDE the VM from snapshot "installed" via scripts/vm/test.sh phase-3.
# Criteria: docs/phase-checklist.md → Phase 3. Full mode executes every focused
# live checkpoint in one freshly restored VM, then validates their union.
set -euo pipefail
if [ "${GKOS_TEST_MODE:-full}" = kernel-live ]; then
  exec bash test/phase-3-kernel-live.sh
fi
if [ "${GKOS_TEST_MODE:-full}" = conformance-runner ]; then
  exec bash test/phase-3-conformance-runner.sh
fi
if [ "${GKOS_TEST_MODE:-full}" = fs-enforcement ]; then
  exec bash test/phase-3-fs-enforcement.sh
fi
if [ "${GKOS_TEST_MODE:-full}" = fs-boundary ]; then
  exec bash test/phase-3-fs-boundary.sh
fi
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
combined="$HOME/phase-3-combined-evidence"
mkdir -p "$combined"
trap 'rc=$?; printf "%s\n" "$rc" > "$combined/combined-exit-code"' EXIT
printf '%s\n' '{"mode":"full","fullPhaseAcceptance":false,"combinedConformanceAcceptance":true,"realSlackAcceptance":false,"realTelegramAcceptance":false,"controlUiGatewayAcceptance":true,"pluginSpecificInstallHookAcceptance":true}' > "$combined/scope.json"

for checkpoint in phase-3-install-evidence phase-3-conformance-runner-evidence phase-3-kernel-live-evidence phase-3-install-hook-evidence phase-3-plugin-install-hook-evidence phase-3-channel-ingress-evidence; do
  rm -rf "$HOME/$checkpoint"
done

bash test/phase-3-install.sh
bash test/phase-3-conformance-runner.sh
fresh_kernel_state(){
  test_state=/home/tester/.openclaw-kernel-test
  if [ -d "$test_state" ]; then find "$test_state" -mindepth 1 -delete; fi
  mkdir -m 700 -p "$test_state"
}
fresh_kernel_state
bash test/phase-3-install-hook.sh
fresh_kernel_state
bash test/phase-3-plugin-install-hook.sh
fresh_kernel_state
bash test/phase-3-channel-ingress.sh
fresh_kernel_state
bash test/phase-3-kernel-live.sh
node test/scripts/combined-phase-3.mjs > "$combined/verdict.json"
pnpm check:catalog
pnpm check:secrets
echo 'phase-3: ALL PASS'
