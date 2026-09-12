#!/usr/bin/env bash
# Actual GitHub read/effect evidence helper, NOT gatekeeper or OAuth acceptance.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] && [ "${CLAWOS_TEST_MODE:-}" = observer-live ] || exit 1
umask 077
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
export CLAWOS_KERNEL_VM=1
export OPENCLAW_STATE_DIR=/home/tester/.openclaw-kernel-test
export OPENCLAW_CONFIG_PATH=/home/tester/.openclaw-kernel-test/openclaw.json
unset OPENCLAW_PROFILE OPENCLAW_GATEWAY_TOKEN GITHUB_TOKEN GH_TOKEN
mkdir -p /home/tester/phase-4-observer-evidence
trap 'printf "%s\n" "$?" > /home/tester/phase-4-observer-evidence/live-exit-code' EXIT
pnpm install --frozen-lockfile --ignore-scripts > /home/tester/github-observer-deps.log 2>&1
pnpm exec tsx test/scripts/github-observer-live.mjs
