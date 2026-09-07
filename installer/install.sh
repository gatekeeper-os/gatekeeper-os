#!/usr/bin/env bash
# OpenClaw OS installer — entry point for `curl -fsSL …/installer/install.sh | bash` and `./installer/install.sh`.
# Installs the pinned upstream OpenClaw and the `clawos` CLI, then hands off to `clawos install` (plan §10.3).
# INVARIANT 1: this script never writes inside the upstream install root or edits upstream's systemd unit.
set -euo pipefail

CLAWOS_REPO="${CLAWOS_REPO:-https://github.com/<org>/openclaw-os}"
CLAWOS_REF="${CLAWOS_REF:-main}"
CLAWOS_CELL="${CLAWOS_CELL:-default}"
CLAWOS_FROM_SOURCE="${CLAWOS_FROM_SOURCE:-}"   # set to a checkout path to install packages from a working tree (VM tests)

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/../clawos.lock.json" ]; then src_root="$(cd "$here/.." && pwd)"; else src_root=""; fi

log() { printf '\033[1;36m[clawos-install]\033[0m %s\n' "$*"; }

# 0. Fetch lockfile to learn the pin (from the checkout if present, else from the repo ref)
if [ -n "$src_root" ]; then lock="$src_root/clawos.lock.json"; else
  lock="$(mktemp)"; curl -fsSL "$CLAWOS_REPO/raw/$CLAWOS_REF/clawos.lock.json" -o "$lock"; fi
pin="$(node -p "JSON.parse(require('fs').readFileSync('$lock','utf8')).upstream.version" 2>/dev/null || sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$lock" | head -1)"
[ -n "$pin" ] || { echo "could not read upstream pin from $lock" >&2; exit 1; }
log "upstream pin: openclaw@$pin"

# 1. Preflight
if [ -n "$src_root" ]; then bash "$src_root/installer/preflight.sh"; else curl -fsSL "$CLAWOS_REPO/raw/$CLAWOS_REF/installer/preflight.sh" | bash; fi

# 2. Node (provisioned by upstream's installer if absent — VERIFIED `--no-onboard`)
if ! command -v node >/dev/null; then
  log "provisioning Node via upstream installer (no onboarding)"
  curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
  hash -r
fi

# 3. Upstream at the pin (never `latest`)
if [ "$(openclaw --version 2>/dev/null | grep -oE '[0-9]{4}\.[0-9]+\.[0-9]+' || true)" != "$pin" ]; then
  log "installing openclaw@$pin"
  npm install -g "openclaw@$pin" --allow-scripts=openclaw
fi
openclaw --version

# 4. clawos CLI
if [ -n "$CLAWOS_FROM_SOURCE" ] || [ -n "$src_root" ]; then
  root="${CLAWOS_FROM_SOURCE:-$src_root}"
  log "installing clawos CLI from source tree $root"
  (cd "$root" && corepack enable >/dev/null 2>&1 || true; pnpm install --frozen-lockfile 2>/dev/null || pnpm install; pnpm build)
  npm install -g "$root/packages/clawos-cli"
else
  cli_ver="$(node -p "JSON.parse(require('fs').readFileSync('$lock','utf8')).plugins['clawos-kernel']" 2>/dev/null || echo latest)"
  npm install -g "@clawos/cli@$cli_ver"
fi

# 5. Hand off: everything else is idempotent and lives in the CLI (plan §10.3 steps 3–12)
export CLAWOS_FROM_SOURCE="${CLAWOS_FROM_SOURCE:-$src_root}"
exec clawos install --cell "$CLAWOS_CELL" --yes
