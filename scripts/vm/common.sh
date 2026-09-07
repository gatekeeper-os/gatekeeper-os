#!/usr/bin/env bash
# Shared driver dispatch for the VM wrappers. Drivers: multipass (default), libvirt, lima, vagrant, ssh.
# See docs/vm-testing.md §3–5.
set -euo pipefail
VM_NAME="${CLAWOS_VM_NAME:-clawos-test}"
DRIVER="${CLAWOS_VM_DRIVER:-multipass}"
VM_USER="${CLAWOS_VM_USER:-tester}"
VM_SRC="${CLAWOS_VM_SRC:-/home/$VM_USER/src}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# VM state (disk, SSH identity, seed, known_hosts) normally belongs to the worktree that created it, and the
# libvirt driver refuses to touch a domain whose disk is not the one in its own state directory.
#
# A phase branch is developed in a fresh worktree but must reuse the immutable `base` snapshot the bootstrap
# worktree built: recreating it would mean re-downloading the cloud image and rebuilding the baseline, and
# deleting it would destroy the reference point every earlier acceptance run was measured against.
#
# CLAWOS_VM_STATE_DIR relocates the state directory deliberately. It does not weaken the ownership check — the
# driver still requires the running domain's disk to be exactly the disk in the selected state directory. It only
# changes *which* directory is authoritative, and the choice is validated before anything uses it.
if [ -n "${CLAWOS_VM_STATE_DIR:-}" ]; then
  STATE_DIR="$(cd "$CLAWOS_VM_STATE_DIR" 2>/dev/null && pwd || true)"
  [ -n "$STATE_DIR" ] || { echo "[vm] CLAWOS_VM_STATE_DIR does not exist: $CLAWOS_VM_STATE_DIR" >&2; exit 1; }
  case "$STATE_DIR" in
    */scripts/vm/.state) ;;
    *) echo "[vm] CLAWOS_VM_STATE_DIR must be a scripts/vm/.state directory, got $STATE_DIR" >&2; exit 1;;
  esac
  # The shared state must belong to a checkout of *this* repository, so a stray path cannot aim the driver at an
  # unrelated VM. Comparing git common directories is what makes the sibling-worktree case legitimate.
  shared_repo="$(cd "$STATE_DIR/../../.." && pwd)"
  mine="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  theirs="$(git -C "$shared_repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -z "$mine" ] || [ "$mine" != "$theirs" ]; then
    echo "[vm] CLAWOS_VM_STATE_DIR is not a worktree of this repository: $STATE_DIR" >&2; exit 1
  fi
  for required in tester.qcow2 ssh-key; do
    [ -e "$STATE_DIR/$required" ] || { echo "[vm] shared VM state is missing $required" >&2; exit 1; }
  done
  echo "[vm] using shared VM state: $STATE_DIR" >&2
else
  STATE_DIR="$REPO_ROOT/scripts/vm/.state"
fi
mkdir -p "$STATE_DIR"

vm_log() { printf '\033[1;35m[vm:%s]\033[0m %s\n' "$DRIVER" "$*" >&2; }
vm_die() { vm_log "ERROR: $*"; exit 1; }

# ---- multipass -------------------------------------------------------------------------------------
mp_up() {
  multipass info "$VM_NAME" >/dev/null 2>&1 && { vm_log "exists"; return; }
  multipass launch 24.04 --name "$VM_NAME" --cpus "${CLAWOS_VM_CPUS:-2}" --memory "${CLAWOS_VM_MEM:-4G}" --disk "${CLAWOS_VM_DISK:-20G}" \
    --cloud-init "$REPO_ROOT/scripts/vm/cloud-init.yaml"
}
mp_exec() { multipass exec "$VM_NAME" -- sudo -u "$VM_USER" -i bash -lc "$1"; }
mp_sync() {
  local tmp; tmp="$(mktemp -d)"; rsync -a --delete --exclude node_modules --exclude .git --exclude dist --exclude vm-artifacts --exclude 'scripts/vm/.state' --exclude 'scripts/vm/secrets.env' "$REPO_ROOT/" "$tmp/src/"
  multipass transfer -r "$tmp/src" "$VM_NAME:/tmp/clawos-src"
  multipass exec "$VM_NAME" -- sudo bash -c "rm -rf '$VM_SRC' && mv /tmp/clawos-src '$VM_SRC' && chown -R $VM_USER:$VM_USER '$VM_SRC'"
  rm -rf "$tmp"
}
mp_snapshot() { multipass stop "$VM_NAME"; multipass snapshot "$VM_NAME" --name "$1" 2>/dev/null || multipass delete --snapshot "$VM_NAME.$1" && multipass snapshot "$VM_NAME" --name "$1"; multipass start "$VM_NAME"; }
mp_reset()    { multipass stop "$VM_NAME" 2>/dev/null || true; multipass restore --destructive "$VM_NAME.$1"; multipass start "$VM_NAME"; }
mp_pull()     { multipass transfer -r "$VM_NAME:$1" "$2"; }

# ---- ssh (cloud VM or any reachable host; snapshots are the operator's responsibility) -----------
ssh_target() { echo "${CLAWOS_VM_HOST:?set CLAWOS_VM_HOST=user@host for the ssh driver}"; }
ssh_up()     { vm_log "ssh driver: VM must already exist at $(ssh_target)"; }
ssh_exec()   { ssh -o BatchMode=yes "$(ssh_target)" "sudo -u $VM_USER -i bash -lc $(printf %q "$1")"; }
ssh_sync()   { rsync -az --delete --exclude node_modules --exclude .git --exclude dist --exclude vm-artifacts --exclude 'scripts/vm/.state' --exclude 'scripts/vm/secrets.env' "$REPO_ROOT/" "$(ssh_target):$VM_SRC/"; }
ssh_snapshot(){ vm_die "ssh driver has no snapshots; use your provider's image/snapshot feature and re-run"; }
ssh_reset()  { vm_die "ssh driver has no snapshots; restore '$1' with your provider and re-run"; }
ssh_pull()   { rsync -az "$(ssh_target):$1" "$2"; }

source "$REPO_ROOT/scripts/vm/libvirt.sh"

# ---- lima / vagrant: TODO(phase-0) implement if that is the hypervisor on the dev host ---
nyi() { vm_die "driver '$DRIVER' not implemented yet — implement in scripts/vm/common.sh or use CLAWOS_VM_DRIVER=multipass|ssh"; }

vm_call() {  # vm_call <op> [args…]
  local op="$1"; shift
  case "$DRIVER" in
    multipass) "mp_$op" "$@";;
    ssh)       "ssh_$op" "$@";;
    libvirt) "lv_$op" "$@";;
    lima|vagrant) nyi;;
    *) vm_die "unknown driver $DRIVER";;
  esac
}
