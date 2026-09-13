# Coder blueprint

Version 0.1.0. Sandboxed coding agent with scoped filesystem and exec inside a container.

Expected gatekeepers: fs, github. Applying this template does not install a driver, connect accounts, issue grants, or bind a channel. Missing dependencies remain pending.

Apply with `gkos blueprint apply coder --agent coder-worker --yes`. Reapply refuses drift instead of overwriting edits. `gkos blueprint diff --agent coder-worker` reports changed paths without exposing contents.

The global tool policy can deny tools this role requests. Blueprint application never loosens that policy; inspect `policyConflicts` and the effective tool surface before routing work.

Cell policy: `runtime`; create a separate cell with `gkos cell create coding --port 18801 --policy runtime` before applying coder. Blueprint application never widens global cell policy.
