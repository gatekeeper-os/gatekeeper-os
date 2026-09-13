#!/usr/bin/env bash
# Phase 1 acceptance — runs INSIDE the VM from snapshot "base" via scripts/vm/test.sh phase-1.
#
# Criteria: docs/phase-checklist.md → Phase 1. Every check prints "PASS <id>" or "FAIL <id>" and writes structural
# evidence into ~/phase-1-evidence/ for the collector. Checks assert observable state (exit codes, JSON fields,
# file modes, unit names, listening ports); none is an echo that would pass on a broken build.
set -uo pipefail
fails=0
platform="$(uname -s)"
hash_file() { node -e 'const fs=require("node:fs"), c=require("node:crypto"); console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1"; }
EV="$HOME/phase-1-evidence"; rm -rf "$EV"; mkdir -p "$EV"
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; fails=$((fails+1)); }
t0=$(date +%s)
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# ---------------------------------------------------------------- install, timed, from a clean base snapshot
# The base snapshot deliberately has no Node; provisioning it is allowed here because this is a disposable VM.
install_t0=$(date +%s)
GKOS_FROM_SOURCE="$PWD" GKOS_ALLOW_NODE_PROVISION=1 bash installer/install.sh >"$EV/install.log" 2>&1
install_rc=$?
install_elapsed=$(( $(date +%s) - install_t0 ))
echo "{\"exit\":$install_rc,\"elapsedSeconds\":$install_elapsed}" > "$EV/install-result.json"
if [ "$install_rc" -eq 0 ]; then pass install; else fail install "exit $install_rc; see install.log"; fi
if [ "$install_elapsed" -lt 600 ]; then pass install-under-10min; else fail install-under-10min "${install_elapsed}s"; fi

export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; hash -r

# ---------------------------------------------------------------- health
gkos status --json > "$EV/status.json" 2>&1
if jq -e '.healthy == true' "$EV/status.json" >/dev/null 2>&1; then pass status-healthy; else fail status-healthy "$(head -c 300 "$EV/status.json")"; fi

# Snapshot refresh mode exits before the drift/second-cell/backup scenarios mutate the clean install.
# It is NOT full Phase 1 acceptance; full acceptance must pass separately before this snapshot is used.
if [ "${GKOS_TEST_INSTALL_ONLY:-0}" = 1 ]; then
  echo '{"mode":"install-only","fullAcceptance":false}' > "$EV/scope.json"
  [ "$fails" -eq 0 ] || exit 1
  echo "phase-1: clean install ready for snapshot (not full acceptance)"
  exit 0
fi

openclaw doctor --lint --json > "$EV/doctor-lint.json" 2>"$EV/doctor-lint.stderr"
lint_rc=$?
echo "$lint_rc" > "$EV/doctor-lint.exit"
# Criterion (corrected, see docs/phase-checklist.md): no ERROR-severity findings. Exit 1 means "findings", and two
# warnings are deliberate consequences of the hardened baseline we are not going to reverse to score a green:
# loopback-only bind, and `skill_workshop` absent from the `messaging` tool profile.
jq -r '[.findings[]? | select(.severity == "error")]' "$EV/doctor-lint.json" > "$EV/doctor-lint-errors.json" 2>/dev/null
jq -r '[.findings[]? | select(.severity != "error") | .checkId]' "$EV/doctor-lint.json" > "$EV/doctor-lint-warnings.json" 2>/dev/null
if [ "$lint_rc" -le 1 ] && jq -e 'length == 0' "$EV/doctor-lint-errors.json" >/dev/null 2>&1; then
  pass doctor-lint-no-errors
else
  fail doctor-lint-no-errors "exit $lint_rc; errors: $(cat "$EV/doctor-lint-errors.json" 2>/dev/null | head -c 300)"
fi

# stderr goes to its own file: upstream prints config warnings there, and mixing them into stdout makes the
# JSON unparseable, which would look like a failed audit rather than a noisy one.
openclaw security audit --deep --json > "$EV/security-audit.json" 2>"$EV/security-audit.stderr"
if jq -e '.summary.critical == 0' "$EV/security-audit.json" >/dev/null 2>&1; then
  pass security-audit-no-critical
else
  fail security-audit-no-critical "critical findings present or audit unparseable"
fi

# ---------------------------------------------------------------- idempotence
gkos install --cell default --yes --json > "$EV/install-again.json" 2>&1
if jq -e '.changed == false' "$EV/install-again.json" >/dev/null 2>&1; then pass install-idempotent; else fail install-idempotent "$(head -c 300 "$EV/install-again.json")"; fi

# The installer already reconciled once, so the very next apply must be a clean no-op.
gkos config apply --json > "$EV/config-apply-1.json" 2>&1
gkos config apply --json > "$EV/config-apply-2.json" 2>&1
if jq -e '.changed == false and (.changes | length) == 0' "$EV/config-apply-2.json" >/dev/null 2>&1; then
  pass config-apply-idempotent
else
  fail config-apply-idempotent "$(head -c 300 "$EV/config-apply-2.json")"
fi

# ---------------------------------------------------------------- concurrent-edit protection (the §6.2 redesign)
# Change an OS-owned path behind the OS's back; `config apply` must refuse, name the path, and change nothing.
openclaw config set gateway.bind '"lan"' --strict-json > "$EV/external-edit.log" 2>&1
gkos config apply --json > "$EV/config-apply-conflict.json" 2>&1
conflict_rc=$?
if [ "$conflict_rc" -ne 0 ] && jq -e '.conflicts | index("gateway.bind") != null' "$EV/config-apply-conflict.json" >/dev/null 2>&1; then
  pass config-apply-detects-concurrent-edit
else
  fail config-apply-detects-concurrent-edit "exit $conflict_rc; $(head -c 300 "$EV/config-apply-conflict.json")"
fi
# The refusal must not have written anything: the owned path still holds the external value, not ours.
openclaw config get gateway.bind --json > "$EV/bind-after-refusal.json" 2>&1
if grep -q lan "$EV/bind-after-refusal.json"; then
  pass config-apply-conflict-changed-nothing
else
  fail config-apply-conflict-changed-nothing "the refused apply still rewrote gateway.bind"
fi
# --force is the documented way through; restore OS ownership so later checks run against a converged cell.
gkos config apply --force --json > "$EV/config-apply-forced.json" 2>&1
if jq -e '.changed == true' "$EV/config-apply-forced.json" >/dev/null 2>&1; then
  pass config-apply-force-recovers
else
  fail config-apply-force-recovers "$(head -c 300 "$EV/config-apply-forced.json")"
fi

# A one-shot PATH shim inserts an upstream edit AFTER dry-run, before the real transaction.
# It removes itself before helper discovery so the helper still loads the actual installed public SDK.
real_openclaw="$(command -v openclaw)"
race_bin="$(mktemp -d)"
cat > "$race_bin/openclaw" <<'SH'
#!/usr/bin/env bash
"$GKOS_TEST_REAL_OPENCLAW" "$@"
rc=$?
if [[ " $* " == *" --dry-run "* && "$rc" = 0 ]]; then
  "$GKOS_TEST_REAL_OPENCLAW" config set gateway.bind '"lan"' --strict-json >/dev/null 2>&1 || exit 90
  rm -- "$0"
fi
exit "$rc"
SH
chmod +x "$race_bin/openclaw"
echo '{tools:{sessions:{visibility:"tree"}}}' > "$HOME/.openclaw/os/config.d/90-local.json5"
before_lock="$(hash_file "$HOME/.openclaw/os/gkos.lock.json")"
PATH="$race_bin:$PATH" GKOS_TEST_REAL_OPENCLAW="$real_openclaw" gkos config apply --force --json > "$EV/config-race.json" 2>&1
race_rc=$?
openclaw config get gateway.bind --json > "$EV/bind-after-race.json" 2>&1
if [ "$race_rc" -ne 0 ] && grep -q lan "$EV/bind-after-race.json" \
  && [ "$before_lock" = "$(hash_file "$HOME/.openclaw/os/gkos.lock.json")" ]; then
  pass config-apply-atomic-race-refusal
else
  fail config-apply-atomic-race-refusal "exit $race_rc; concurrent edit or checkpoint was overwritten"
fi
# Prove the refusal was the revision guard, not a broken helper: identical desired input now succeeds.
gkos config apply --force --json > "$EV/config-race-recovery.json" 2>&1
if [ "$?" -eq 0 ] && jq -e '.changed == true' "$EV/config-race-recovery.json" >/dev/null; then
  pass config-apply-atomic-race-recovery
else
  fail config-apply-atomic-race-recovery "transaction failed without a competing writer"
fi
echo '{}' > "$HOME/.openclaw/os/config.d/90-local.json5"
gkos config apply --json > "$EV/config-race-cleanup.json" 2>&1 || fail config-race-cleanup

# ---------------------------------------------------------------- second cell, concurrently
gkos cell create firma --port 18801 --yes --json > "$EV/cell-create.json" 2>&1
cell_rc=$?
gkos --cell firma status --json > "$EV/status-firma.json" 2>&1
if [ "$cell_rc" -eq 0 ] && jq -e '.healthy == true' "$EV/status-firma.json" >/dev/null 2>&1; then
  pass second-cell
else
  fail second-cell "exit $cell_rc; $(head -c 300 "$EV/status-firma.json")"
fi

if [ "$platform" = Darwin ]; then
  launchctl print "gui/$(id -u)/ai.openclaw.gateway" | awk '/state =/{print}' > "$EV/units.txt"
  launchctl print "gui/$(id -u)/ai.openclaw.firma" | awk '/state =/{print}' >> "$EV/units.txt"
  if [ "$(grep -c 'state = running' "$EV/units.txt")" -eq 2 ]; then pass two-cells-concurrent
  else fail two-cells-concurrent; fi
  lsof -nP -iTCP:18789 -iTCP:18801 -sTCP:LISTEN > "$EV/listening-ports.txt"
  if grep -q ':18789 ' "$EV/listening-ports.txt" && grep -q ':18801 ' "$EV/listening-ports.txt"; then pass two-cells-separate-ports
  else fail two-cells-separate-ports; fi
else
  systemctl --user list-units 'openclaw-gateway*' --no-pager > "$EV/units.txt" 2>&1
  if systemctl --user is-active --quiet openclaw-gateway.service \
    && systemctl --user is-active --quiet openclaw-gateway-firma.service; then pass two-cells-concurrent
  else fail two-cells-concurrent; fi
  ss -ltn 2>/dev/null | grep -E ':(18789|18801)\b' > "$EV/listening-ports.txt" 2>&1
  if [ "$(grep -c . "$EV/listening-ports.txt")" -ge 2 ]; then pass two-cells-separate-ports
  else fail two-cells-separate-ports; fi
fi

if [ -d "$HOME/.openclaw/os" ] && [ -d "$HOME/.openclaw-firma/os" ]; then
  pass two-cells-separate-state-dirs
else
  fail two-cells-separate-state-dirs "expected ~/.openclaw/os and ~/.openclaw-firma/os"
fi
# Separate keys are what makes a cell a trust boundary; identical keys would be a security defect.
if [ -s "$HOME/.openclaw/os/cell.key" ] && [ -s "$HOME/.openclaw-firma/os/cell.key" ] \
  && ! cmp -s "$HOME/.openclaw/os/cell.key" "$HOME/.openclaw-firma/os/cell.key"; then
  pass two-cells-distinct-keys
else
  fail two-cells-distinct-keys "cell keys are missing or identical"
fi
ls -la "$HOME" | grep -E '\.openclaw' > "$EV/state-dirs.txt" 2>&1
gkos cell list --json > "$EV/cell-list.json" 2>&1

# ---------------------------------------------------------------- backup round-trip
gkos backup create --json > "$EV/backup-create.json" 2>&1
archive="$(jq -r '.archive // empty' "$EV/backup-create.json" 2>/dev/null)"
if [ -n "$archive" ] && [ -f "$archive" ]; then pass backup-create; else fail backup-create "no archive produced"; fi
# Prove the archive really carries this cell's OS state rather than an empty shell.
# NB: `tar … | grep -q` under `set -o pipefail` reports failure even on a match, because grep exits first and tar
# dies of SIGPIPE. List to a file and grep the file instead.
if [ -n "$archive" ] && [ -f "$archive" ]; then tar tzf "$archive" > "$EV/archive-listing.txt" 2>&1; fi
if grep -q 'os/gkos\.lock\.json' "$EV/archive-listing.txt" 2>/dev/null; then
  pass backup-contains-os-state
else
  fail backup-contains-os-state "archive does not contain os/gkos.lock.json"
fi
if [ -n "$archive" ] && [ -f "$archive" ]; then
  # A marker written after the backup must be gone once the archive is restored — that is what proves the restore
  # actually replaced state rather than leaving the live directory untouched.
  echo marker > "$HOME/.openclaw/os/logs/post-backup-marker"
  gkos backup restore "$archive" --yes --json > "$EV/backup-restore.json" 2>&1
  restore_rc=$?
  if [ "$restore_rc" -eq 0 ] && [ ! -f "$HOME/.openclaw/os/logs/post-backup-marker" ]; then
    pass backup-restore-roundtrip
  else
    fail backup-restore-roundtrip "exit $restore_rc; marker present: $([ -f "$HOME/.openclaw/os/logs/post-backup-marker" ] && echo yes || echo no)"
  fi
  gkos status --json > "$EV/status-after-restore.json" 2>&1
  if jq -e '.healthy == true' "$EV/status-after-restore.json" >/dev/null 2>&1; then
    pass healthy-after-restore
  else
    fail healthy-after-restore "cell not healthy after restore"
  fi
fi

# ---------------------------------------------------------------- drop-in and permissions
if [ "$platform" = Darwin ]; then
  plist="$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"
  if grep -q '^OPENCLAW_NO_AUTO_UPDATE=1$' "$HOME/.openclaw/.env" && grep -q '^GKOS_CELL=default$' "$HOME/.openclaw/.env"; then
    pass launchd-cell-environment
  else fail launchd-cell-environment; fi
  if [ -f "$plist" ] && plutil -lint "$plist" >/dev/null; then pass upstream-launchagent-present
  else fail upstream-launchagent-present; fi
  perm() { stat -f %Lp "$1" 2>/dev/null; }
else
dropin="$HOME/.config/systemd/user/openclaw-gateway.service.d/gkos.conf"
if grep -q 'OPENCLAW_NO_AUTO_UPDATE=1' "$dropin" 2>/dev/null && grep -q 'GKOS_CELL=default' "$dropin" 2>/dev/null; then
  pass dropin-present
else
  fail dropin-present "$dropin missing the required Environment lines"
fi
# The drop-in must be a drop-in: the settings the OS owns must appear only in gkos.conf, never in upstream's
# unit file (INVARIANT 1 at the host level). Upstream's own unit may legitimately reference GKOS_GATEWAY_TOKEN
# as a managed env *key*, because upstream reads ~/.openclaw/.env itself — that is upstream managing upstream.
unit="$HOME/.config/systemd/user/openclaw-gateway.service"
if ! grep -qE '^(Environment=)?(GKOS_CELL=|OPENCLAW_NO_AUTO_UPDATE=)' "$unit" 2>/dev/null \
  && grep -q 'OPENCLAW_NO_AUTO_UPDATE=1' "$dropin" 2>/dev/null; then
  pass upstream-unit-unmodified
else
  fail upstream-unit-unmodified "OS-owned Environment lines leaked into upstream's unit file"
fi
cp "$unit" "$EV/upstream-unit.service" 2>/dev/null || true
cp "$dropin" "$EV/gkos.conf" 2>/dev/null || true

perm() { stat -c %a "$1" 2>/dev/null; }
fi

{
  echo "openclaw.json $(perm "$HOME/.openclaw/openclaw.json")"
  echo "stateDir      $(perm "$HOME/.openclaw")"
  echo "os            $(perm "$HOME/.openclaw/os")"
  echo "cell.key      $(perm "$HOME/.openclaw/os/cell.key")"
  echo "dotenv        $(perm "$HOME/.openclaw/.env")"
} > "$EV/permissions.txt"
if [ "$(perm "$HOME/.openclaw/openclaw.json")" = 600 ] \
  && [ "$(perm "$HOME/.openclaw")" = 700 ] \
  && [ "$(perm "$HOME/.openclaw/os")" = 700 ] \
  && [ "$(perm "$HOME/.openclaw/os/cell.key")" = 600 ]; then
  pass perms
else
  fail perms "$(tr '\n' ' ' < "$EV/permissions.txt")"
fi

# ---------------------------------------------------------------- gkos doctor
gkos doctor --json > "$EV/gkos-doctor.json" 2>&1
doctor_rc=$?
if [ "$doctor_rc" -eq 0 ]; then pass gkos-doctor; else fail gkos-doctor "exit $doctor_rc; $(head -c 300 "$EV/gkos-doctor.json")"; fi

# ---------------------------------------------------------------- honest scope
# This installer regression includes packaged kernel/fs health, not full Phase 3 conformance.
cat > "$EV/scope.json" <<'JSON'
{
  "phase": 1,
  "implemented": ["installer/preflight", "gkos install", "cell", "status", "doctor", "config apply", "backup"],
  "notImplemented": {
    "kernelAcceptance": "Bundled kernel/fs health is checked by install; full Phase 3 acceptance is separate",
    "gatekeeperAcceptance": "No resource grants or gatekeeper operations are exercised by this installer regression",
    "conformance": "This installer regression does not run the Phase 3 conformance suites",
    "curlInstaller": "the repository is private and no @gatekeeper-os/* package is published; source install only",
    "macos": "platform-specific acceptance; see platform.txt for this run"
  }
}
JSON

uname -s > "$EV/platform.txt"
cp "$HOME/.openclaw/os/gkos.lock.json" "$EV/gkos.lock.json" 2>/dev/null || true
openclaw --version > "$EV/openclaw-version.txt" 2>&1
openclaw plugins list --json > "$EV/plugins.json" 2>&1
echo "elapsed: $(( $(date +%s) - t0 ))s" | tee "$EV/elapsed.txt"

if [ "$fails" -eq 0 ]; then echo "phase-1: ALL PASS"; else echo "phase-1: $fails FAIL"; exit 1; fi
