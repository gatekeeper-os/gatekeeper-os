#!/usr/bin/env bash
# Usage: scripts/vm/snapshot.sh <name>
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
vm_call snapshot "${1:?snapshot name}"
vm_log "snapshot '$1' taken"
