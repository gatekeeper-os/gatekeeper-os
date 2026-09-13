#!/usr/bin/env bash
# Pre-publish checkpoint only: no npm login/publish, tag or registry installation.
set -euo pipefail
[ "$HOME" = /home/tester ] && [ "$PWD" = /home/tester/src ] || exit 1
export GKOS_TEST_MODE=blueprint-sandbox GKOS_RELEASE_AUDIT=1
exec bash test/phase-6.sh
