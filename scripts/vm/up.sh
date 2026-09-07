#!/usr/bin/env bash
# Create the VM, wait for cloud-init, take snapshot "base".
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
vm_call up
vm_log "waiting for cloud-init"
vm_call exec 'cloud-init status --wait >/dev/null 2>&1 || true; echo ready'
vm_call exec 'command -v node && echo "ERROR: node must not be preinstalled in base" && exit 1 || true'
vm_call snapshot base
vm_log "snapshot 'base' taken"
