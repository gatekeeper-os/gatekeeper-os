#!/usr/bin/env bash
# The ONLY command an acceptance run may use: reset → sync → run test/<phase>.sh inside → collect artifacts.
# Usage: scripts/vm/test.sh phase-1 [snapshot]   (snapshot defaults per docs/vm-testing.md §5 table)
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
phase="${1:?phase, e.g. phase-1}"
case "$phase" in
  phase-0|phase-1) default_snap=base;;
  phase-3|phase-4|phase-6) default_snap=installed;;
  phase-5|phase-7) default_snap=connected;;
  phase-2)
    # Explicit library-only exception in docs/vm-testing.md. No VM or Gateway is started.
    out="$REPO_ROOT/vm-artifacts/$(date -u +%Y%m%d-%H%M%S)-phase-2"
    mkdir -p "$out"
    printf 'host-only\n' > "$out/snapshot"
    printf 'library-acceptance\n' > "$out/mode"
    (cd "$REPO_ROOT" && git rev-parse HEAD) > "$out/revision"
    node --version > "$out/node-version"
    node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).upstream.version)' "$REPO_ROOT/clawos.lock.json" > "$out/upstream-pin"
    set +e
    (cd "$REPO_ROOT" && bash test/phase-2.sh) 2>&1 | tee "$out/run.log"
    rc=${PIPESTATUS[0]}
    set -e
    printf '%s\n' "$rc" > "$out/exit-code"
    vm_log "artifacts: $out (exit $rc)"
    exit "$rc";;
  *) vm_die "unknown phase $phase";;
esac
snap="${2:-$default_snap}"
mode="${3:-full}"
case "$phase:$mode" in
  *:full) install_only=0;;
  phase-1:install-only) install_only=1;;
  phase-3:fs-boundary|phase-3:fs-enforcement|phase-3:conformance-runner|phase-3:kernel-live) install_only=0;;
  *) vm_die "unsupported acceptance mode: $phase $mode";;
esac
ts="$(date -u +%Y%m%d-%H%M%S)"
out="$REPO_ROOT/vm-artifacts/$ts-$phase"; mkdir -p "$out"
echo "$snap" > "$out/snapshot"
echo "$mode" > "$out/mode"

bash "$REPO_ROOT/scripts/vm/reset.sh" "$snap"
bash "$REPO_ROOT/scripts/vm/sync.sh"

# Secrets are injected as env for this run only (docs/vm-testing.md §6); never written into the VM tree.
if [ -s "$REPO_ROOT/scripts/vm/secrets.env" ]; then
  vm_die "Legacy secrets.env command-line injection is disabled; use protected credential delivery"
fi

start_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
vm_call exec "cd $VM_SRC && env CLAWOS_TEST_MODE=$mode CLAWOS_TEST_INSTALL_ONLY=$install_only CLAWOS_TEST_START='$start_ts' bash test/$phase.sh" 2>&1 | tee "$out/run.log"
rc=${PIPESTATUS[0]}
set -e
echo "$rc" > "$out/exit-code"

if ! bash "$REPO_ROOT/scripts/vm/collect.sh" "$out" "$start_ts" "$phase" "$mode"; then
  rc=99
  echo "$rc" > "$out/exit-code"
fi
vm_log "artifacts: $out (exit $rc)"
exit "$rc"
