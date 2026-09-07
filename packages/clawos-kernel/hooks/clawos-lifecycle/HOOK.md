---
name: clawos-lifecycle
description: Flushes the OS audit log before a Gateway restart.
metadata:
  openclaw:
    events: ["gateway:pre-restart", "gateway:shutdown"]
    hookKey: clawos-lifecycle
    export: default
---
