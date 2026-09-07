---
name: write-blueprint
description: Create or modify an OpenClaw OS blueprint (a versioned agent template with workspace files, skills, tool policy, sandbox profile, and expected gatekeepers). Load when adding or changing a blueprint.
---

# Writing a blueprint

A blueprint lives at `packages/clawos-blueprints/<name>/` with `blueprint.json` (schema: `blueprint.schema.json`), `AGENTS.md`,
`SOUL.md`, optional `USER.md`/`IDENTITY.md`/`BOOT.md`, `skills/`, and `README.md` (added to the agent's bootstrap files).

Rules enforced by `clawos blueprint lint`: `exec`/`group:runtime` in `toolPolicy.allow` requires `sandbox.mode: "all"`;
`group:fs` requires `sandbox.mode` ≠ `off`; every `expectedGatekeepers` entry exists in `config/gatekeepers.json`; `AGENTS.md`
tells the agent it starts with no access and how to use `os_request_access`.

`clawos blueprint apply <name> --agent <id>` runs `openclaw agents add <id> --workspace … --non-interactive`, copies workspace
files, writes `agents.entries.<id>` into `os/config.d/30-agents.json5`, runs `clawos config apply`, and snapshots to
`os/blueprints/<id>/` so `blueprint diff` can show drift. Applying twice is a no-op.
