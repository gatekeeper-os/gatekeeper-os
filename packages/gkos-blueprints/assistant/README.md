# Assistant blueprint

Version 0.1.0. Messaging-only personal assistant. No filesystem or shell access; uses gatekeepers for everything external.

Expected gatekeepers: github. Applying this template does not install a driver, connect accounts, issue grants, or bind a channel. Missing dependencies remain pending.

Apply with `gkos blueprint apply assistant --agent assistant-worker --yes`. Reapply refuses drift instead of overwriting edits. `gkos blueprint diff --agent assistant-worker` reports changed paths without exposing contents.

The global tool policy can deny tools this role requests. Blueprint application never loosens that policy; inspect `policyConflicts` and the effective tool surface before routing work.

Cell policy: `messaging` (default). Blueprint application never widens global cell policy.

### Per-gatekeeper tool ownership

See [pinned registration diagnosis and catalog reconciliation](../../../docs/gatekeeper-tool-ownership.md). Each driver
manifest declares its exact tools. The kit owns upstream wrappers; kernel grant
checks still gate every execution. `gkos config apply` adds/removes enabled catalog
plugin IDs in messaging policies (including messaging agents). Native denials,
explicit runtime allowlists, and sandbox settings remain unchanged. Blueprint
application does not install gatekeepers or create grants.
