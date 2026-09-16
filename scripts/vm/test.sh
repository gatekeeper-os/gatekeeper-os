#!/usr/bin/env bash
# The ONLY command an acceptance run may use: reset → sync → run test/<phase>.sh inside → collect artifacts.
# Usage: scripts/vm/test.sh phase-1 [snapshot]   (snapshot defaults per docs/vm-testing.md §5 table)
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
phase="${1:?phase, e.g. phase-1}"
case "$phase" in
  phase-0|phase-1) default_snap=base;;
  phase-3|phase-4|phase-6|phase-8|phase-9) default_snap=installed;;
  phase-5|phase-7) default_snap=connected;;
  phase-2)
    # Explicit library-only exception in docs/vm-testing.md. No VM or Gateway is started.
    out="$REPO_ROOT/vm-artifacts/$(date -u +%Y%m%d-%H%M%S)-phase-2"
    mkdir -p "$out"
    printf 'host-only\n' > "$out/snapshot"
    printf 'library-acceptance\n' > "$out/mode"
    (cd "$REPO_ROOT" && git rev-parse HEAD) > "$out/revision"
    node --version > "$out/node-version"
    node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).upstream.version)' "$REPO_ROOT/gkos.lock.json" > "$out/upstream-pin"
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
  phase-8:mcp-boundary|phase-3:npm-only) install_only=0;;

  phase-9:prepublish|phase-6:blueprint-sandbox) install_only=0;;
  phase-7:runtime-checkpoint) install_only=0;;
  phase-1:install-only) install_only=1;;
  phase-5:approvals-live|phase-3:fs-boundary|phase-3:fs-enforcement|phase-3:conformance-runner|phase-3:kernel-live|phase-3:install-integration|phase-3:install-hook|phase-3:plugin-install-hook|phase-3:channel-ingress) install_only=0;;
  *) vm_die "unsupported acceptance mode: $phase $mode";;
esac
ts="$(date -u +%Y%m%d-%H%M%S)"
out="$REPO_ROOT/vm-artifacts/$ts-$phase"; mkdir -p "$out"
echo "$snap" > "$out/snapshot"
echo "$mode" > "$out/mode"

if [ "$phase:$mode" = phase-3:npm-only ]; then
  source "$REPO_ROOT/scripts/vm/preflight.sh"
  vm_test_preflight
fi
bash "$REPO_ROOT/scripts/vm/reset.sh" "$snap"
if [ "$phase:$mode" = phase-3:npm-only ]; then
  [ "$DRIVER" = libvirt ] || vm_die 'npm-only acceptance currently requires the owned libvirt VM'
  VM_SRC=/home/tester/npm-acceptance
  # The installed snapshot contains an old source checkout. Remove it before any
  # product invocation; transfer only test fixtures, never a checkout or build.
  vm_call exec 'systemctl --user stop "openclaw-gateway*.service" || true; python3 -c '\''import pathlib,shutil; p=pathlib.Path("/home/tester/src"); shutil.rmtree(p) if p.exists() else None; p=pathlib.Path("/home/tester/npm-acceptance"); shutil.rmtree(p) if p.exists() else None; p.mkdir(mode=0o700)'\'''
  transport="ssh -F /dev/null -i $LV_KEY -p $LV_PORT -o BatchMode=yes -o UserKnownHostsFile=$STATE_DIR/known_hosts"
  rsync -az -e "$transport" "$REPO_ROOT/test/npm-only/" "$VM_USER@127.0.0.1:$VM_SRC/"
  rsync -az -e "$transport" "$REPO_ROOT/test/phase-3-npm-only.sh" "$VM_USER@127.0.0.1:$VM_SRC/run.sh"
  git -C "$REPO_ROOT" rev-parse HEAD > "$out/revision"
  (cd "$REPO_ROOT" && sha256sum test/phase-3-npm-only.sh && find test/npm-only -type f -exec sha256sum {} +) > "$out/harness-sha256"
else
  bash "$REPO_ROOT/scripts/vm/sync.sh"
fi

# Secrets are injected as env for this run only (docs/vm-testing.md §6); never written into the VM tree.
if [ -s "$REPO_ROOT/scripts/vm/secrets.env" ]; then
  vm_die "Legacy secrets.env command-line injection is disabled; use protected credential delivery"
fi

test_script="test/$phase.sh"
if [ "$phase:$mode" = phase-3:npm-only ]; then test_script=run.sh; fi
if [ "$phase:$mode" = phase-3:install-integration ]; then test_script=test/phase-3-install.sh; fi

if [ "$phase:$mode" = phase-3:install-hook ]; then test_script=test/phase-3-install-hook.sh; fi

if [ "$phase:$mode" = phase-3:plugin-install-hook ]; then test_script=test/phase-3-plugin-install-hook.sh; fi

if [ "$phase:$mode" = phase-3:channel-ingress ]; then test_script=test/phase-3-channel-ingress.sh; fi

start_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
vm_call exec "cd $VM_SRC && env GKOS_TEST_MODE=$mode GKOS_TEST_INSTALL_ONLY=$install_only GKOS_TEST_START='$start_ts' bash $test_script" 2>&1 | tee "$out/run.log"
rc=${PIPESTATUS[0]}
set -e
echo "$rc" > "$out/exit-code"

if ! bash "$REPO_ROOT/scripts/vm/collect.sh" "$out" "$start_ts" "$phase" "$mode"; then
  rc=99
  echo "$rc" > "$out/exit-code"
fi
vm_log "artifacts: $out (exit $rc)"
exit "$rc"
