# Gatekeeper skeleton

Follow `.agents/skills/write-gatekeeper/SKILL.md` (two STOP points). Copy `packages/gatekeeper-github` as the reference.

```
packages/gatekeeper-<vendor>/
├── openclaw.plugin.json     # id gatekeeper-<vendor>, contracts.tools, clawos.gatekeeper marker
├── package.json             # openclaw.extensions, openclaw.compat (catalog range), peerDependencies.openclaw
├── deploy-inputs.json       # which secrets, console URL, redirect URI template
├── src/
│   ├── index.ts             # export default defineGatekeeper({...})
│   ├── vendor.ts            # GatekeeperVendor: describe, connectAccount, resources, getTools
│   ├── account.ts           # token store use, refresh, getGatekeeperFor
│   ├── <resource>.ts        # one KitGatekeeper subclass per resource type: observations{}, actions{}, addObserver
│   ├── tools.ts             # GatekeeperToolDef[] — every tool takes `grant`; descriptions never mention approvals
│   ├── simulate.ts          # overlay rules per action kind
│   └── api.ts               # thin wrapper over the vendor HTTP API; errors pass through sanitizeError()
└── test/                    # kit harness: fake ApprovalQueue, recorded HTTP fixtures
```

Rules the kit enforces at `defineGatekeeper()` time:
1. Every tool has a `grant` parameter.
2. No tool description contains "approv", "oauth", "cache", "queue", "simulat" (case-insensitive).
3. Every action tool provides `describe(params)` (dry pass) and `apply(params)`; `simulate` is required unless `awaitDecision: true`.
4. Every resource type declares an `observerStrategy`.
5. The gatekeeper never calls `api.registerTool` — the kernel does.

Action lifecycle inside the kit: `describe` → kernel decides (requireApproval or queue) → `simulate(params, overlay)` → tool
returns success → later `applyAction(id)` → `apply(params)` → overlay entry retired; or `rejectAction(id)` → overlay entry
removed; or `revertAction(id)` → `revert(record)`.

OAuth: use `OAuthNonceMachine` (two-stage nonce, 10-minute lifetime, timing-safe compare) and `TokenStore` (AES-256-GCM with
the cell key). Redirect URI: `${gateway.publicOrigin}/os/gatekeeper/<vendor>/oauth/callback` (route registered by the kernel).
