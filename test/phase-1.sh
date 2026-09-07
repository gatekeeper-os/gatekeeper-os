#!/usr/bin/env bash
# Phase 1 acceptance — runs INSIDE the VM from snapshot "base" via scripts/vm/test.sh phase-1.
#
# Criteria: docs/phase-checklist.md → Phase 1. Every check prints "PASS <id>" or "FAIL <id>" and writes structural
# evidence into ~/phase-1-evidence/ for the collector. Checks assert observable state (exit codes, JSON fields,
# file modes, unit names, listening ports); none is an echo that would pass on a broken build.
set -uo pipefail
fails=0
EV="$HOME/phase-1-evidence"; rm -rf "$EV"; mkdir -p "$EV"
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: ${2:-}"; fails=$((fails+1)); }
t0=$(date +%s)
export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# ---------------------------------------------------------------- install, timed, from a clean base snapshot
# The base snapshot deliberately has no Node; provisioning it is allowed here because this is a disposable VM.
install_t0=$(date +%s)
CLAWOS_FROM_SOURCE="$PWD" CLAWOS_ALLOW_NODE_PROVISION=1 bash installer/install.sh >"$EV/install.log" 2>&1
install_rc=$?
install_elapsed=$(( $(date +%s) - install_t0 ))
echo "{\"exit\":$install_rc,\"elapsedSeconds\":$install_elapsed}" > "$EV/install-result.json"
if [ "$install_rc" -eq 0 ]; then pass install; else fail install "exit $install_rc; see install.log"; fi
if [ "$install_elapsed" -lt 600 ]; then pass install-under-10min; else fail install-under-10min "${install_elapsed}s"; fi

export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; hash -r

# ---------------------------------------------------------------- health
clawos status --json > "$EV/status.json" 2>&1
if jq -e '.healthy == true' "$EV/status.json" >/dev/null 2>&1; then pass status-healthy; else fail status-healthy "$(head -c 300 "$EV/status.json")"; fi

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
clawos install --cell default --yes --json > "$EV/install-again.json" 2>&1
if jq -e '.changed == false' "$EV/install-again.json" >/dev/null 2>&1; then pass install-idempotent; else fail install-idempotent "$(head -c 300 "$EV/install-again.json")"; fi

# The installer already reconciled once, so the very next apply must be a clean no-op.
clawos config apply --json > "$EV/config-apply-1.json" 2>&1
clawos config apply --json > "$EV/config-apply-2.json" 2>&1
if jq -e '.changed == false and (.changes | length) == 0' "$EV/config-apply-2.json" >/dev/null 2>&1; then
  pass config-apply-idempotent
else
  fail config-apply-idempotent "$(head -c 300 "$EV/config-apply-2.json")"
fi

# ---------------------------------------------------------------- concurrent-edit protection (the §6.2 redesign)
# Change an OS-owned path behind the OS's back; `config apply` must refuse, name the path, and change nothing.
openclaw config set gateway.bind '"lan"' --strict-json > "$EV/external-edit.log" 2>&1
clawos config apply --json > "$EV/config-apply-conflict.json" 2>&1
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
clawos config apply --force --json > "$EV/config-apply-forced.json" 2>&1
if jq -e '.changed == true' "$EV/config-apply-forced.json" >/dev/null 2>&1; then
  pass config-apply-force-recovers
else
  fail config-apply-force-recovers "$(head -c 300 "$EV/config-apply-forced.json")"
fi

# ---------------------------------------------------------------- second cell, concurrently
clawos cell create firma --port 18801 --yes --json > "$EV/cell-create.json" 2>&1
cell_rc=$?
clawos --cell firma status --json > "$EV/status-firma.json" 2>&1
if [ "$cell_rc" -eq 0 ] && jq -e '.healthy == true' "$EV/status-firma.json" >/dev/null 2>&1; then
  pass second-cell
else
  fail second-cell "exit $cell_rc; $(head -c 300 "$EV/status-firma.json")"
fi

systemctl --user list-units 'openclaw-gateway*' --no-pager > "$EV/units.txt" 2>&1
if systemctl --user is-active --quiet openclaw-gateway.service \
  && systemctl --user is-active --quiet openclaw-gateway-firma.service; then
  pass two-cells-concurrent
else
  fail two-cells-concurrent "both units are not simultaneously active"
fi

ss -ltn 2>/dev/null | grep -E ':(18789|18801)\b' > "$EV/listening-ports.txt" 2>&1
if [ "$(grep -c . "$EV/listening-ports.txt")" -ge 2 ]; then
  pass two-cells-separate-ports
else
  fail two-cells-separate-ports "$(cat "$EV/listening-ports.txt")"
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
clawos cell list --json > "$EV/cell-list.json" 2>&1

# ---------------------------------------------------------------- backup round-trip
clawos backup create --json > "$EV/backup-create.json" 2>&1
archive="$(jq -r '.archive // empty' "$EV/backup-create.json" 2>/dev/null)"
if [ -n "$archive" ] && [ -f "$archive" ]; then pass backup-create; else fail backup-create "no archive produced"; fi
# Prove the archive really carries this cell's OS state rather than an empty shell.
# NB: `tar … | grep -q` under `set -o pipefail` reports failure even on a match, because grep exits first and tar
# dies of SIGPIPE. List to a file and grep the file instead.
if [ -n "$archive" ] && [ -f "$archive" ]; then tar tzf "$archive" > "$EV/archive-listing.txt" 2>&1; fi
if grep -q 'os/clawos\.lock\.json' "$EV/archive-listing.txt" 2>/dev/null; then
  pass backup-contains-os-state
else
  fail backup-contains-os-state "archive does not contain os/clawos.lock.json"
fi
if [ -n "$archive" ] && [ -f "$archive" ]; then
  # A marker written after the backup must be gone once the archive is restored — that is what proves the restore
  # actually replaced state rather than leaving the live directory untouched.
  echo marker > "$HOME/.openclaw/os/logs/post-backup-marker"
  clawos backup restore "$archive" --yes --json > "$EV/backup-restore.json" 2>&1
  restore_rc=$?
  if [ "$restore_rc" -eq 0 ] && [ ! -f "$HOME/.openclaw/os/logs/post-backup-marker" ]; then
    pass backup-restore-roundtrip
  else
    fail backup-restore-roundtrip "exit $restore_rc; marker present: $([ -f "$HOME/.openclaw/os/logs/post-backup-marker" ] && echo yes || echo no)"
  fi
  clawos status --json > "$EV/status-after-restore.json" 2>&1
  if jq -e '.healthy == true' "$EV/status-after-restore.json" >/dev/null 2>&1; then
    pass healthy-after-restore
  else
    fail healthy-after-restore "cell not healthy after restore"
  fi
fi

# ---------------------------------------------------------------- drop-in and permissions
dropin="$HOME/.config/systemd/user/openclaw-gateway.service.d/clawos.conf"
if grep -q 'OPENCLAW_NO_AUTO_UPDATE=1' "$dropin" 2>/dev/null && grep -q 'CLAWOS_CELL=default' "$dropin" 2>/dev/null; then
  pass dropin-present
else
  fail dropin-present "$dropin missing the required Environment lines"
fi
# The drop-in must be a drop-in: the settings the OS owns must appear only in clawos.conf, never in upstream's
# unit file (INVARIANT 1 at the host level). Upstream's own unit may legitimately reference CLAWOS_GATEWAY_TOKEN
# as a managed env *key*, because upstream reads ~/.openclaw/.env itself — that is upstream managing upstream.
unit="$HOME/.config/systemd/user/openclaw-gateway.service"
if ! grep -qE '^(Environment=)?(CLAWOS_CELL=|OPENCLAW_NO_AUTO_UPDATE=)' "$unit" 2>/dev/null \
  && grep -q 'OPENCLAW_NO_AUTO_UPDATE=1' "$dropin" 2>/dev/null; then
  pass upstream-unit-unmodified
else
  fail upstream-unit-unmodified "OS-owned Environment lines leaked into upstream's unit file"
fi
cp "$unit" "$EV/upstream-unit.service" 2>/dev/null || true
cp "$dropin" "$EV/clawos.conf" 2>/dev/null || true

perm() { stat -c %a "$1" 2>/dev/null; }
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

# ---------------------------------------------------------------- clawos doctor
clawos doctor --json > "$EV/clawos-doctor.json" 2>&1
doctor_rc=$?
if [ "$doctor_rc" -eq 0 ]; then pass clawos-doctor; else fail clawos-doctor "exit $doctor_rc; $(head -c 300 "$EV/clawos-doctor.json")"; fi

# ---------------------------------------------------------------- honest scope
# Phase 1 does not implement the kernel, so the conformance suite's tests are still `todo`. Record that in the
# evidence rather than letting a green Phase 1 imply conformance coverage that does not exist.
cat > "$EV/scope.json" <<'JSON'
{
  "phase": 1,
  "implemented": ["installer/preflight", "clawos install", "cell", "status", "doctor", "config apply", "backup"],
  "notImplemented": {
    "kernel": "Phase 3 - no clawos-kernel plugin is installed; `clawos install` reports step 6 as deferred",
    "gatekeepers": "Phase 3+",
    "conformance": "12 conformance tests remain `todo`; Phase 1 asserts none of them",
    "curlInstaller": "the repository is private and no @clawos/* package is published; source install only",
    "macos": "not exercised by this run - see plans/PROGRESS.md"
  }
}
JSON

cp "$HOME/.openclaw/os/clawos.lock.json" "$EV/clawos.lock.json" 2>/dev/null || true
openclaw --version > "$EV/openclaw-version.txt" 2>&1
openclaw plugins list --json > "$EV/plugins.json" 2>&1
echo "elapsed: $(( $(date +%s) - t0 ))s" | tee "$EV/elapsed.txt"

if [ "$fails" -eq 0 ]; then echo "phase-1: ALL PASS"; else echo "phase-1: $fails FAIL"; exit 1; fi
