#!/usr/bin/env bash
# Full Phase 4 must not substitute mock transport, PAT import, or TODO suites for
# real OAuth and native approval evidence. The obsolete CLI scaffold is retired.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
umask 077
evidence=/home/tester/phase-4-evidence
mkdir -p "$evidence"
printf '%s\n' '{"mode":"full","status":"blocked","fullPhaseAcceptance":false,"realProvider":false,"blockers":["disposable-github-account-repository-oauth-app","protected-oauth-setup-and-real-provider-scenarios","native-await-decision-action-and-roundtrip"]}' > "$evidence/scope.json"
printf '2\n' > "$evidence/live-exit-code"
echo 'BLOCKED phase-4: real OAuth/provider and native approval acceptance are not implemented/verified; see plans/PROGRESS.md.'
echo 'The separate gateway-integration mode uses a synthetic provider and cannot pass this gate.'
exit 2
