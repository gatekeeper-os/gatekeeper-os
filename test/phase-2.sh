#!/usr/bin/env bash
# Phase 2 library acceptance: no OpenClaw runtime or service, explicit host-only exception.
set -euo pipefail
pnpm --filter @gatekeeper-os/shared --filter @gatekeeper-os/gatekeeper-kit build
pnpm --filter @gatekeeper-os/shared --filter @gatekeeper-os/gatekeeper-kit typecheck
pnpm --filter @gatekeeper-os/shared --filter @gatekeeper-os/gatekeeper-kit test
pnpm check:catalog
pnpm check:secrets
