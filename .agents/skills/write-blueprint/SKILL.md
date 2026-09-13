---
name: write-blueprint
description: Create or modify an GatekeeperOS blueprint (a versioned agent template with workspace files, skills, tool policy, sandbox profile, and expected gatekeepers). Load when adding or changing a blueprint.
---

# Writing a blueprint

A blueprint lives at `packages/gkos-blueprints/<name>/` with `blueprint.json` (schema: `blueprint.schema.json`), `AGENTS.md`,
`SOUL.md`, optional `USER.md`/`IDENTITY.md`/`BOOT.md`, `skills/`, and `README.md` (added to the agent's bootstrap files).

Rules enforced by `gkos blueprint lint`: `exec`/`group:runtime` in `toolPolicy.allow` requires `sandbox.mode: "all"`;
`group:fs` requires `sandbox.mode` ≠ `off`; every `expectedGatekeepers` entry exists in `config/gatekeepers.json`; `AGENTS.md`
tells the agent it starts with no access and how to use `os_request_access`.

`gkos blueprint apply <name> --agent <id>` runs `openclaw agents add <id> --workspace … --non-interactive`, copies workspace
files, writes `agents.entries.<id>` into `os/config.d/30-agents.json5`, runs `gkos config apply`, and snapshots to
`os/blueprints/<id>/` so `blueprint diff` can show drift. Applying twice is a no-op.

## Implemented Phase 6 contract (2026-09-12)

Apply requires `--yes`, preserves global policy and reports dependency/policy
limits without claiming readiness. It refuses existing-agent adoption, workspace
or policy drift, and incomplete provisioning; `pending.json` requires inspection.
Do not remove expected gatekeepers to obtain a passing lint or runtime result.

The published upstream bootstrap-extra-files hook does not accept README.md.
Application therefore copies README.md and includes its contents in managed
AGENTS.md for normal bootstrap injection. Sandbox projection pins Docker agent
scope, network:none, read-only root, dropped capabilities, sandbox exec host and
no elevated mode. This does not grant back tools denied by global policy.
See `docs/blueprints.md`; use the reduced VM checkpoint only for its stated scope.
