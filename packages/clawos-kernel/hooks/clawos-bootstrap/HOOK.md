---
name: clawos-bootstrap
description: Adds the applied blueprint README to the agent's bootstrap files.
metadata:
  openclaw:
    events: ["agent:bootstrap"]
    hookKey: clawos-bootstrap
    export: default
---
Adds `<stateDir>/os/blueprints/<agentId>/README.md` to `context.bootstrapFiles` (the one documented mutable field) when present.
Runs unsandboxed in the Gateway process — kept tiny and reviewed at the kernel bar (plan §5.6).
