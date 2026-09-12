#!/usr/bin/env bash
# Phase 2 library acceptance: no OpenClaw runtime or service, explicit host-only exception.
set -euo pipefail
pnpm --filter @clawkeepers/shared --filter @clawkeepers/gatekeeper-kit build
pnpm --filter @clawkeepers/shared --filter @clawkeepers/gatekeeper-kit typecheck
pnpm --filter @clawkeepers/shared --filter @clawkeepers/gatekeeper-kit test
pnpm check:catalog
pnpm check:secrets
