#!/usr/bin/env bash
# Phase 2 is host-only (unit tests for clawos-shared and gatekeeper-kit). scripts/vm/test.sh phase-2 runs `pnpm test`.
set -euo pipefail
pnpm --filter @clawos/shared --filter @clawos/gatekeeper-kit test
