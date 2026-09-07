#!/usr/bin/env bash
# Create the VM, wait for cloud-init, take snapshot "base".
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
vm_call up
vm_log "waiting for cloud-init"
vm_call exec 'cloud-init status --wait'
vm_call exec 'if command -v node; then echo "ERROR: node must not be preinstalled in base"; exit 1; fi'
vm_call snapshot base
vm_log "snapshot 'base' taken"
