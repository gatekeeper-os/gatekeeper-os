# Blueprints

`clawos blueprint list` lists the four versioned templates packaged with the CLI.
`clawos blueprint lint coder` validates the schema, declared files, capability
instructions, tool/sandbox policy and known gatekeeper names. A directory path
may be used for lint; apply accepts only a packaged blueprint name.

```sh
clawos --cell work blueprint apply coder --agent dev --yes
clawos --cell work blueprint diff --agent dev
```

Apply registers an **unbound** agent through `openclaw agents add`, copies only
validated workspace/skill files, merges one agent into `30-agents.json5`, and
runs the existing config reconciliation transaction. It never connects accounts,
installs drivers, copies credentials, creates grants or modifies global tool
policy. Do not route work to a new agent until application and effective-policy
inspection complete. Existing agents/workspaces are not adopted implicitly.

The successful snapshot stores hashes of files and the agent's noncredential
policy. Reapply checks both workspace and config and performs no writes if they
match. Drift reports include **paths only**, not old/new contents. Reapply refuses
to overwrite drift. Template version changes require a separately reviewed
migration; this first implementation does not erase files or silently upgrade.
`pending.json` identifies an interrupted apply; inspect its stage and the new
agent/config before repairing. A pending operation is never a successful snapshot.
The OS-side lock serializes blueprint writers; the upstream config revision
transaction independently guards edits to the live config. A concurrent fragment
edit is also refused. A stale lock after process death requires operator review.

## Safety and readiness

- Runtime tools (including `process` and the coding profile) require sandbox
  `mode: all`. Native filesystem tools require a sandbox.
- Sandbox profiles use Docker, agent scope, explicit `network: none`, read-only
  root, dropped capabilities, `exec.host: sandbox` and disabled elevated tools.
  No environment, bind mounts, host/SSH fallback or network override is accepted
  in a blueprint. The operator must provision the configured sandbox image.
- `alsoAllow` extends the chosen profile; it cannot restore tools denied by a
  global/provider policy. It does not grant capability handles.
- A fresh installed OS baseline denies `group:runtime`, `group:fs`, and
  `group:automation` globally. Thus coder/ops remain restricted until an operator
  explicitly chooses a cell policy suitable for those roles. Apply reports
  `policyConflicts`; it never removes the denylist automatically.
- `dependencyPending` means the expected vendor is absent from the cell's
  registered catalog. Presence is **not a runtime health, OAuth, grant, or full
  acceptance claim**. All receipts say `fullAcceptance: false`. Use
  `clawos gatekeeper list` to inspect live kernel health before routing work.
- `github` remains a separate Phase 4 integration checkpoint; `http` is still a
  placeholder. Ops/researcher keep their `http` dependency. No fake driver is
  registered to make them appear ready.

Upstream does not bootstrap arbitrary README files (its extra-files hook accepts
specific basenames only). Apply retains README.md and appends its content to the
managed AGENTS.md, so the normal supported bootstrap path injects the guide.

## Verification scope

`scripts/vm/test.sh phase-6 installed blueprint-sandbox` runs a packed CLI in the
restored VM and a separate loopback cell with an **explicit fixture policy**,
leaving the installed cell/baseline unchanged. Four synthetic-model agent turns
exercise the real Gateway. The coder invokes native exec and Docker state proves
network:none, read-only root and no Docker socket. No personal provider, GitHub
account, HTTP driver or real notification destination is used.

The `full` mode returns blocked (exit 2) until driver/role policy and integration
gates are implemented and accepted. A checkpoint success must not be promoted to
four production-ready agents, full Phase 6, or a phase tag.

Inherited global Docker binds are rejected for sandboxed blueprints: upstream
merges them with per-agent binds, so an empty per-agent list cannot remove them.
A later config fragment that changes the provisioned agent policy also blocks
reconciliation before it can publish that override as an accepted snapshot.

Kernel-owned tools are explicitly permitted at profile and sandbox-policy layers;
the kernel still hides ungranted `gk_*` schemas and enforces capability checks.
Its prompt filter preserves native tool groups within upstream's existing policy
intersection, so it cannot restore native tools an operator denied. This makes
sandboxed exec usable without weakening the capability boundary.
