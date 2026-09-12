# Blueprints

`clawos blueprint list` lists the four versioned templates packaged with the CLI.
`clawos blueprint lint coder` validates the schema, declared files, capability
instructions, tool/sandbox policy and known gatekeeper names. A directory path
may be used for lint; apply accepts only a packaged blueprint name.

```sh
clawos cell create work --port 19100 --policy runtime --yes
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
- A cell's global policy is a ceiling: agent settings cannot restore denied tools.
  `clawos cell create <name> --port <port> --policy messaging|runtime` selects the
  cell profile; messaging is the default and preserves the deny-by-default baseline.
  Runtime permission and default sandbox `mode: all` live in one inseparable
  `05-policy-runtime.json5` fragment. Config apply refuses an unsafe runtime fragment.
- Coder declares runtime policy; assistant, ops and researcher declare messaging policy.
  Apply checks the effective config through upstream's config surface before writes.
  Applying coder in a messaging cell refuses and prints the exact command to create
  a separate runtime cell; it never widens an existing cell's global policy.
- Researcher exposes only `web_search` and `web_fetch`; `gatekeeper-http` is planned
  beyond this beta, not an expected dependency. Assistant and ops deny exec and fs.
- `dependencyPending` means an expected vendor is absent from the cell's registered
  catalog. Presence is **not runtime health, OAuth, grants, or full acceptance**.
  All receipts say `fullAcceptance: false`; use `clawos gatekeeper list` before routing
  work. GitHub remains a separate Phase 4 integration checkpoint.

Upstream does not bootstrap arbitrary README files (its extra-files hook accepts
specific basenames only). Apply retains README.md and appends its content to the
managed AGENTS.md, so the normal supported bootstrap path injects the guide.

## Verification scope

`scripts/vm/test.sh phase-6 installed blueprint-sandbox` uses the packed CLI
inside a restored VM to create real runtime and messaging cells. The runtime cell
provisions coder and proves actual Docker exec, network:none, read-only root and no
Docker socket. The messaging cell refuses coder with the exact new-cell command,
then provisions assistant, ops and researcher and verifies their actual Gateway
model-request tool lists, including positive controls. Policy fragments and the
installed baseline are checked; no fixture replaces the global policy.

A synthetic loopback model and a minimal Debian sandbox image provide the test
workload. No personal provider, GitHub account, HTTP driver or notification
recipient is used. `full` remains blocked pending driver integration; this focused
checkpoint is not full Phase 6 acceptance or a phase tag.

### Release audit gate

Audit each actual cell with its own token-authenticated Gateway in the same run.
No critical finding is accepted. A failed command, missing/failed deep probe,
suppressed finding, unknown warning or unmet predicate fails the gate. Only these
exact warning codes are accepted, with no prefix or category wildcard:

- `gateway.trusted_proxies_missing`: accepted only for `bind: loopback`, where no reverse proxy is configured; never invent trusted proxies.
- `tools.exec.host_sandbox_no_sandbox_agents`: accepted only in a messaging cell whose global exec/runtime/fs denial is verified; exec remains unavailable.
- `tools.exec.security_full_configured`: accepted only in a runtime cell with default and every agent's effective sandbox `mode: all` verified in the same run.

`gateway.probe_failed` is never an exception: the audit uses the cell token through
the canonical `CLAWOS_GATEWAY_TOKEN` SecretRef environment provider and the cell's real state/identity. Findings are recorded
only as IDs and severities, never raw diagnostics or credential values.

Inherited global Docker binds are rejected for sandboxed blueprints: upstream
merges them with per-agent binds, so an empty per-agent list cannot remove them.
A later config fragment that changes the provisioned agent policy also blocks
reconciliation before it can publish that override as an accepted snapshot.

Except for the web-tools-only researcher, kernel-owned tools are explicitly permitted at profile and sandbox-policy layers;
the kernel still hides ungranted `gk_*` schemas and enforces capability checks.
Its prompt filter preserves native tool groups within upstream's existing policy
intersection, so it cannot restore native tools an operator denied. This makes
sandboxed exec usable without weakening the capability boundary.
