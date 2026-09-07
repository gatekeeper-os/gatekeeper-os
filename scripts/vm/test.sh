#!/usr/bin/env bash
# The ONLY command an acceptance run may use: reset → sync → run test/<phase>.sh inside → collect artifacts.
# Usage: scripts/vm/test.sh phase-1 [snapshot]   (snapshot defaults per docs/vm-testing.md §5 table)
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
phase="${1:?phase, e.g. phase-1}"
case "$phase" in
  phase-0|phase-1) default_snap=base;;
  phase-3|phase-4|phase-6) default_snap=installed;;
  phase-5|phase-7) default_snap=connected;;
  phase-2) vm_log "phase-2 is host-only: running pnpm test"; (cd "$REPO_ROOT" && pnpm test); exit $?;;
  *) vm_die "unknown phase $phase";;
esac
snap="${2:-$default_snap}"
ts="$(date -u +%Y%m%d-%H%M%S)"
out="$REPO_ROOT/vm-artifacts/$ts-$phase"; mkdir -p "$out"
echo "$snap" > "$out/snapshot"

bash "$REPO_ROOT/scripts/vm/reset.sh" "$snap"
bash "$REPO_ROOT/scripts/vm/sync.sh"

# Secrets are injected as env for this run only (docs/vm-testing.md §6); never written into the VM tree.
if [ -s "$REPO_ROOT/scripts/vm/secrets.env" ]; then
  vm_die "Legacy secrets.env command-line injection is disabled; use protected credential delivery"
fi

start_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
vm_call exec "cd $VM_SRC && env CLAWOS_TEST_START='$start_ts' bash test/$phase.sh" 2>&1 | tee "$out/run.log"
rc=${PIPESTATUS[0]}
set -e
echo "$rc" > "$out/exit-code"

if ! bash "$REPO_ROOT/scripts/vm/collect.sh" "$out" "$start_ts" "$phase"; then
  rc=99
  echo "$rc" > "$out/exit-code"
fi
vm_log "artifacts: $out (exit $rc)"
exit "$rc"
