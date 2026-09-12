# Ops blueprint

Version 0.1.0. Scheduled operations agent: cron-driven summaries and notifications.

Expected gatekeepers: github, http. Applying this template does not install a driver, connect accounts, issue grants, or bind a channel. Missing dependencies remain pending.

Apply with `clawos blueprint apply ops --agent ops-worker --yes`. Reapply refuses drift instead of overwriting edits. `clawos blueprint diff --agent ops-worker` reports changed paths without exposing contents.

The global tool policy can deny tools this role requests. Blueprint application never loosens that policy; inspect `policyConflicts` and the effective tool surface before routing work.
