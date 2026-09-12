#!/usr/bin/env bash
# OpenClaw OS installer.
#
# INVARIANT 1: this script never writes inside the upstream install root and never edits upstream's systemd unit.
#
# Supported entry points
# ----------------------
#   ./installer/install.sh                                     from a checkout (the supported path today)
#   CLAWOS_FROM_SOURCE=/path/to/checkout bash installer/install.sh
#
# NOT yet supported: `curl -fsSL …/install.sh | bash`. That form needs either a public repository or an
# authenticated fetch, and `ControlStackAI/openclaw-os` is private. No `@clawkeepers/*` package is published to npm
# either, so there is no registry path to fall back to. Rather than shipping a one-liner that cannot work, this
# script detects the piped-without-a-checkout case and reports exactly what is missing. Plan §10.2 is corrected
# to match; the one-liner becomes real when the packages are published.
set -euo pipefail

CLAWOS_CELL="${CLAWOS_CELL:-default}"
# Provisioning Node is only ever appropriate on a disposable machine: it runs a third-party install script that
# mutates the host toolchain. The VM acceptance run opts in; a developer host must not be changed silently.
CLAWOS_ALLOW_NODE_PROVISION="${CLAWOS_ALLOW_NODE_PROVISION:-0}"

log()  { printf '\033[1;36m[clawos-install]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[clawos-install]\033[0m %s\n' "$*" >&2; exit 1; }

# 0. Locate the source checkout. Everything is installed from it; there is no registry path yet.
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
src_root="${CLAWOS_FROM_SOURCE:-}"
if [ -z "$src_root" ] && [ -n "$here" ] && [ -f "$here/../clawos.lock.json" ]; then
  src_root="$(cd "$here/.." && pwd)"
fi
[ -n "$src_root" ] && [ -f "$src_root/clawos.lock.json" ] || fail \
"no source checkout found.
  OpenClaw OS has no published packages and its repository is private, so there is no
  curl-to-bash install yet. Clone the repository and run the script from it:
      git clone https://github.com/ControlStackAI/openclaw-os.git
      cd openclaw-os && ./installer/install.sh
  or set CLAWOS_FROM_SOURCE=/path/to/checkout."
log "source checkout: $src_root"

# 1. Read the pin. The pin is the only thing that decides the upstream version (INVARIANT 2).
lock="$src_root/clawos.lock.json"
pin="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([0-9]\{4\}\.[0-9]*\.[0-9]*\)".*/\1/p' "$lock" | head -1)"
[ -n "$pin" ] || fail "could not read the upstream pin from $lock"
log "upstream pin: openclaw@$pin"

# 2. Preflight
bash "$src_root/installer/preflight.sh"

# 3. Node, only where provisioning it is appropriate.
if ! command -v node >/dev/null 2>&1; then
  [ "$CLAWOS_ALLOW_NODE_PROVISION" = "1" ] || fail \
"node is not installed.
  Install Node 22.22.3+, 24.15+ or 25.9+ and re-run. This installer provisions Node
  automatically only on a disposable machine, which must opt in with
  CLAWOS_ALLOW_NODE_PROVISION=1 (the VM acceptance run sets it)."
  log "provisioning Node via upstream's installer (disposable host, no onboarding)"
  curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
  hash -r
  export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || fail "node is still not on PATH after provisioning"
# npm is verified here rather than in preflight: on a clean host it only exists once Node is provisioned.
command -v npm >/dev/null 2>&1 || fail "npm is not on PATH (it should have arrived with Node)"
log "node $(node -p 'process.versions.node'), npm $(npm --version)"

# 4. Upstream at the pin, never `latest`.
current="$(openclaw --version 2>/dev/null | grep -oE '[0-9]{4}\.[0-9]+\.[0-9]+' | head -1 || true)"
if [ "$current" != "$pin" ]; then
  log "installing openclaw@$pin (was: ${current:-absent})"
  npm install -g "openclaw@$pin" --allow-scripts=openclaw
else
  log "openclaw@$pin already installed"
fi
openclaw --version

# 5. Build and install the `clawos` CLI as a packed tarball.
#
# A packed tarball, not `npm install -g packages/clawos-cli`: a global install of the workspace directory would
# carry dependency specifiers npm cannot resolve outside pnpm, and would not include the config templates.
# `npm pack` produces exactly the files listed in the package's `files` field — `dist/`, `bin/` and the staged
# `templates/` — which is a self-contained artifact that installs on a host with nothing but Node.
log "building the clawos CLI from source"
# The build needs pnpm at the exact version the lockfile was written with. Corepack is the preferred route, but
# it is not always enabled on a fresh host and `corepack enable` can fail silently, so fall back to a *pinned*
# global install read from the repository's own `packageManager` field. Never `pnpm@latest`: a different pnpm
# could resolve the lockfile differently, which is the thing --frozen-lockfile exists to prevent.
pm="$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\(pnpm@[0-9.]*\)".*/\1/p' "$src_root/package.json" | head -1)"
[ -n "$pm" ] || fail "could not read packageManager from $src_root/package.json"
corepack enable >/dev/null 2>&1 || true
if ! command -v pnpm >/dev/null 2>&1; then
  log "pnpm not available via corepack; installing $pm globally"
  npm install -g "$pm"
fi
command -v pnpm >/dev/null 2>&1 || fail "pnpm is not on PATH after provisioning"
log "pnpm $(pnpm --version)"
(
  cd "$src_root"
  # Fail closed. A frozen install that fell back to resolving a fresh lockfile would silently install dependency
  # versions nobody reviewed, which defeats the point of committing a lockfile (plan §7.5).
  pnpm install --frozen-lockfile
  pnpm --filter @clawkeepers/cli... run build
)

pack_dir="$(mktemp -d)"
trap 'rm -rf "$pack_dir"' EXIT
tarball="$(cd "$src_root/packages/clawos-cli" && npm pack --pack-destination "$pack_dir" --silent | tail -1)"
[ -n "$tarball" ] && [ -f "$pack_dir/$tarball" ] || fail "npm pack did not produce a tarball"
log "installing clawos from $tarball"
npm install -g "$pack_dir/$tarball"

# 6. Hand off. Everything from here is idempotent and lives in the CLI (plan §10.3 steps 3–12).
command -v clawos >/dev/null 2>&1 || fail "clawos is not on PATH after installation"
export CLAWOS_FROM_SOURCE="$src_root"
exec clawos install --cell "$CLAWOS_CELL" --yes
