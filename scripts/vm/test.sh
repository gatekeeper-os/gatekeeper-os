#!/usr/bin/env bash
# The ONLY command an acceptance run may use: reset → sync → run test/<phase>.sh inside → collect artifacts.
# Usage: scripts/vm/test.sh phase-1 [snapshot]   (snapshot defaults per docs/vm-testing.md §5 table)
set +x # Never trace protected stdin credentials.
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
  phase-3:fs-boundary|phase-3:fs-enforcement|phase-3:conformance-runner|phase-3:kernel-live|phase-3:install-integration|phase-3:install-hook|phase-3:plugin-install-hook|phase-3:channel-ingress) install_only=0;;
  phase-4:gateway-integration|phase-4:upstream-logging|phase-4:observer-live) install_only=0;;
  *) vm_die "unsupported acceptance mode: $phase $mode";;
esac
# Read before SSH/reset can consume stdin. Only these credentialed test modes
# accept one bounded JSON envelope; nothing is interpolated into remote argv.
protected_input=''
if [ "${CLAWOS_TEST_INPUT_STDIN:-0}" = 1 ]; then
  case "$phase:$mode" in phase-4:full|phase-4:observer-live) ;; *) vm_die 'protected stdin unsupported for this mode';; esac
  protected_input=$(python3 -c 'import sys,json; raw=sys.stdin.read(16385); assert 0<len(raw)<=16384; value=json.loads(raw); assert isinstance(value,dict); print(json.dumps(value))')
fi
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

test_script="test/$phase.sh"
if [ "$phase:$mode" = phase-4:gateway-integration ]; then test_script=test/phase-4-gateway.sh; fi
if [ "$phase:$mode" = phase-4:upstream-logging ]; then test_script=test/phase-4-upstream.sh; fi
if [ "$phase:$mode" = phase-4:observer-live ]; then test_script=test/phase-4-observer.sh; fi
if [ "$phase:$mode" = phase-3:install-integration ]; then test_script=test/phase-3-install.sh; fi

if [ "$phase:$mode" = phase-3:install-hook ]; then test_script=test/phase-3-install-hook.sh; fi

if [ "$phase:$mode" = phase-3:plugin-install-hook ]; then test_script=test/phase-3-plugin-install-hook.sh; fi

if [ "$phase:$mode" = phase-3:channel-ingress ]; then test_script=test/phase-3-channel-ingress.sh; fi

launcher="bash $test_script"
if [ -n "$protected_input" ]; then
  printf '%s' "$protected_input" | vm_call exec "umask 077; python3 -c 'import os,sys; raw=sys.stdin.buffer.read(16385); assert 0<len(raw)<=16384; fd=os.open(\"/run/user/1000/clawos-phase4-delivery.json\",os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600); f=os.fdopen(fd,\"wb\"); f.write(raw); f.close()'"
  unset protected_input
  launcher="node test/scripts/github-protected-launch.mjs $test_script"
fi
start_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
vm_call exec "cd $VM_SRC && env CLAWOS_TEST_MODE=$mode CLAWOS_TEST_INSTALL_ONLY=$install_only CLAWOS_TEST_START='$start_ts' $launcher" 2>&1 | tee "$out/run.log"
rc=${PIPESTATUS[0]}
set -e
echo "$rc" > "$out/exit-code"

if ! bash "$REPO_ROOT/scripts/vm/collect.sh" "$out" "$start_ts" "$phase" "$mode"; then
  rc=99
  echo "$rc" > "$out/exit-code"
fi
vm_log "artifacts: $out (exit $rc)"
exit "$rc"
