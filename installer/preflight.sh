#!/usr/bin/env bash
# Preflight checks for OpenClaw OS (plan §9 Phase 1 step 1). Exit non-zero on a hard failure; warn otherwise.
set -euo pipefail

warn() { printf 'preflight: WARN %s\n' "$*" >&2; }
fail() { printf 'preflight: FAIL %s\n' "$*" >&2; exit 1; }
ok()   { printf 'preflight: ok   %s\n' "$*"; }

# OS
case "$(uname -s)" in
  Linux)
    command -v systemctl >/dev/null || fail "systemd is required on Linux"
    if grep -qi microsoft /proc/version 2>/dev/null; then ok "WSL2 detected"; fi
    ok "Linux with systemd";;
  Darwin) ok "macOS (launchd)";;
  *) fail "unsupported OS $(uname -s)";;
esac

# Non-root
[ "$(id -u)" -ne 0 ] || fail "run as a normal user, not root"

# Node (docs: 22.22.3+, 24.15+, or 25.9+). Missing Node is not fatal: install.sh provisions it via upstream's installer.
if command -v node >/dev/null; then
  v="$(node -p 'process.versions.node')"
  node -e '
    const [M,m,p]=process.versions.node.split(".").map(Number);
    const ok=(M===22&&(m>22||(m===22&&p>=3)))||(M===24&&m>=15)||(M===25&&m>=9)||M>=26;
    process.exit(ok?0:1)' && ok "node $v" || fail "node $v is below the minimum (22.22.3+, 24.15+, 25.9+)"
else
  warn "node not found — install.sh will provision it"
fi

# Container runtime (optional)
if command -v docker >/dev/null || command -v podman >/dev/null; then ok "container runtime present"; else warn "no docker/podman: sandboxed blueprints will be unavailable"; fi

# Port
port="${OPENCLAW_GATEWAY_PORT:-18789}"
if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":${port} "; then fail "port ${port} is in use"; else ok "port ${port} free"; fi

# umask / home perms
umask 077
ok "umask 077"
# Disk
avail_kb=$(df -Pk "$HOME" | awk 'NR==2{print $4}')
[ "$avail_kb" -gt 2000000 ] && ok "disk >2GB free" || warn "less than 2GB free in \$HOME"
# TODO(phase-1): loginctl linger check on Linux; curl/tar/jq presence; locale.
