# Assistant blueprint

Version 0.1.0. Messaging-only personal assistant. No filesystem or shell access; uses gatekeepers for everything external.

Expected gatekeepers: github. Applying this template does not install a driver, connect accounts, issue grants, or bind a channel. Missing dependencies remain pending.

Apply with `clawos blueprint apply assistant --agent assistant-worker --yes`. Reapply refuses drift instead of overwriting edits. `clawos blueprint diff --agent assistant-worker` reports changed paths without exposing contents.

The global tool policy can deny tools this role requests. Blueprint application never loosens that policy; inspect `policyConflicts` and the effective tool surface before routing work.
