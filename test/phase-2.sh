#!/usr/bin/env bash
# Phase 2 library acceptance: no OpenClaw runtime or service, explicit host-only exception.
set -euo pipefail
pnpm --filter @clawos/shared --filter @clawos/gatekeeper-kit build
pnpm --filter @clawos/shared --filter @clawos/gatekeeper-kit typecheck
pnpm --filter @clawos/shared --filter @clawos/gatekeeper-kit test
pnpm check:catalog
pnpm check:secrets
