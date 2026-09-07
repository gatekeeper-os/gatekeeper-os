#!/usr/bin/env bash
# Preflight checks for OpenClaw OS (plan §9 Phase 1 step 1). Exit non-zero on a hard failure; warn otherwise.
#
# Preflight has to stay compatible with the idempotence criterion: `clawos install` must be re-runnable against a
# healthy cell. A naive "the port must be free" check makes that impossible, because on the second run the port is
# occupied by the very Gateway the first run started. So an occupied port is a failure only when the listener is
# not this cell's own Gateway.
set -euo pipefail

warn() { printf 'preflight: WARN %s\n' "$*" >&2; }
fail() { printf 'preflight: FAIL %s\n' "$*" >&2; exit 1; }
ok()   { printf 'preflight: ok   %s\n' "$*"; }

CELL="${CLAWOS_CELL:-default}"
if [ "$CELL" = "default" ]; then
  UNIT="openclaw-gateway.service"
  STATE_DIR="$HOME/.openclaw"
  PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
else
  UNIT="openclaw-gateway-$CELL.service"
  STATE_DIR="$HOME/.openclaw-$CELL"
  PORT="${OPENCLAW_GATEWAY_PORT:?a named cell requires OPENCLAW_GATEWAY_PORT}"
fi

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

# Node (docs: 22.22.3+, 24.15+, or 25.9+). Missing Node is not fatal here: install.sh decides whether it may be
# provisioned, which is only ever true on a disposable machine.
if command -v node >/dev/null; then
  v="$(node -p 'process.versions.node')"
  node -e '
    const [M,m,p]=process.versions.node.split(".").map(Number);
    const ok=(M===22&&(m>22||(m===22&&p>=3)))||(M===24&&m>=15)||(M===25&&m>=9)||M>=26;
    process.exit(ok?0:1)' && ok "node $v" || fail "node $v is below the minimum (22.22.3+, 24.15+, 25.9+)"
else
  warn "node not found — install.sh decides whether it may be provisioned"
fi

# Required tools. `npm` is deliberately not in this list: it arrives with Node, and on a clean host Node has not
# been provisioned yet when preflight runs. install.sh verifies npm after the Node step instead.
for tool in curl tar; do
  command -v "$tool" >/dev/null || fail "$tool is required"
done
ok "curl, tar present"
if command -v npm >/dev/null; then ok "npm present"; else warn "npm not found - it arrives with Node"; fi

# Container runtime (optional)
if command -v docker >/dev/null || command -v podman >/dev/null; then
  ok "container runtime present"
else
  warn "no docker/podman: sandboxed blueprints will be unavailable"
fi

# Port. Occupied is fine when this cell already owns the listener — that is what a re-run looks like.
port_busy() {
  if command -v ss >/dev/null; then ss -H -ltn "sport = :${PORT}" 2>/dev/null | grep -q .
  elif command -v lsof >/dev/null; then lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1
  else fail "ss or lsof is required to check the Gateway port"; fi
}
if port_busy; then
  if systemctl --user is-active --quiet "$UNIT" 2>/dev/null; then
    ok "port ${PORT} is held by ${UNIT} (this cell) — install will converge it"
  elif curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1 && [ -d "$STATE_DIR/os" ]; then
    ok "port ${PORT} answers /healthz and ${STATE_DIR}/os exists — treating as this cell"
  else
    fail "port ${PORT} is in use by something that is not cell '${CELL}'"
  fi
else
  ok "port ${PORT} free"
fi

# Linger: without it, user units stop when the last session ends, so an always-on cell needs it.
if [ "$(uname -s)" = "Linux" ] && command -v loginctl >/dev/null; then
  if loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null | grep -qi '^yes$'; then
    ok "linger enabled for $(id -un)"
  else
    warn "linger is not enabled; clawos install will run 'loginctl enable-linger $(id -un)'"
  fi
fi

# umask / disk
umask 077
ok "umask 077"
avail_kb=$(df -Pk "$HOME" | awk 'NR==2{print $4}')
if [ "$avail_kb" -gt 2000000 ]; then ok "disk >2GB free"; else warn "less than 2GB free in \$HOME"; fi
