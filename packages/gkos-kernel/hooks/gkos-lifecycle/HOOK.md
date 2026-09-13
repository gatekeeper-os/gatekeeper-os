---
name: gkos-lifecycle
description: Flushes the OS audit log before a Gateway restart.
metadata:
  openclaw:
    events: ["gateway:pre-restart", "gateway:shutdown"]
    hookKey: gkos-lifecycle
    export: default
---
