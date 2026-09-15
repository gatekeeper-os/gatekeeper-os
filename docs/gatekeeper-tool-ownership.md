# Gatekeeper tool ownership (pinned OpenClaw 2026.9.2)

## Diagnosis before implementation

The beta.4 npm-only run `20260914-130203-phase-3` hit **registration rejection (b)**,
not a missing grant and not merely a messaging-profile expansion problem.

Pinned upstream build: commit `3928bad9badfcb6c7d140530435e806fb8092190`, version
`2026.9.2`, built `2026-09-05T15:22:41.651Z` (published `dist/build-info.json`).
The retained guest reports the same version; its `dist/loader-DPiOPJjR.js` SHA256 is
`0a85e54f83928aa7ad6781289a10e2602e0d0b950beac55b92e5278892a8a438`.

Exact upstream path:

1. [`registry-api.ts:183`](https://github.com/openclaw/openclaw/blob/3928bad9badfcb6c7d140530435e806fb8092190/src/plugins/registry-api.ts#L183)
   binds `registerTool(record, tool, opts)` to the registering plugin record.
2. [`registry-registrars-tools-hooks.ts:212`](https://github.com/openclaw/openclaw/blob/3928bad9badfcb6c7d140530435e806fb8092190/src/plugins/registry-registrars-tools-hooks.ts#L212)
   reads `record.contracts.tools` at line 220, includes object `tool.name` at 232,
   rejects undeclared names at 235–242 **before** `registry.tools.push` at 247.
   Accepted registration ownership is `pluginId: record.id` (248).
   Published equivalents: `loader-DPiOPJjR.js:1911,3909–3941`.
3. [`tool-contracts.ts:21`](https://github.com/openclaw/openclaw/blob/3928bad9badfcb6c7d140530435e806fb8092190/src/plugins/tool-contracts.ts#L21)
   uses exact set membership, not wildcard contracts.
4. [`tools.ts:1378`](https://github.com/openclaw/openclaw/blob/3928bad9badfcb6c7d140530435e806fb8092190/src/plugins/tools.ts#L1378)
   repeats the contract check for factory-produced tools; line 1418 assigns accepted
   tool metadata to `entry.pluginId`. An unnamed factory cannot bypass the check.
5. [`tool-policy.ts:180`](https://github.com/openclaw/openclaw/blob/3928bad9badfcb6c7d140530435e806fb8092190/src/agents/tool-policy.ts#L180)
   groups **accepted runtime tools** by `metadata.pluginId` (180–201); expands plugin
   IDs from those groups (205–232); merges `alsoAllow` into profile allow (346–353).
   This is not direct manifest-array expansion. Rejected registrations are absent.

Retained `/home/tester/npm-only-gateway.log`:

```text
22: 2026-09-14T13:06:33.479+00:00 [gateway] [plugins] plugin must declare contracts.tools for: gk_fixture_record_write (plugin=gkos-kernel, source=/home/tester/.openclaw-kernel-test/os/plugins/9ae9b0a29e99402d25ac2c6cf56030f5e6748a9fa1173f4801e7c014c67c1a2e/gkos-kernel/dist/index.js)
25: 2026-09-14T13:06:33.513+00:00 [gateway] http server listening (6 plugins: gkos-channel-ingress, gkos-gatekeeper-fixture, gkos-gatekeeper-fs, gkos-kernel, gkos-kernel-monitor, memory-core; 5.6s)
33: 2026-09-14T13:06:35.908+00:00 [provider-transport-fetch] [model-fetch] start provider=spike api=openai-completions model=spike method=POST url=http://127.0.0.1:19101/v1/chat/completions timeoutMs=undefined proxy=none policy=custom
38: 2026-09-14T13:06:36.037+00:00 [agents/agent-command] [agent] run 5e5b9361-19ce-46bd-9d6f-694cf501b906 ended with stopReason=stop
43: 2026-09-14T13:06:36.191+00:00 [shutdown] completed cleanly in 61ms
```

There is no additional tool-denial line in the retained console log. The guest's
old `/tmp/openclaw/openclaw-2026-09-14.log` is no longer present. The prior read-only
supported `chat.history` RPC receipt records session
`agent:approval-fixture:kernel-fixture-apply`, tool-result `isError:true`, exact text
`Tool gk_fixture_record_write not found`. Do not relabel that RPC receipt as a log line.

| Retained manifest | `id` | `contracts.tools` |
|---|---|---|
| Synthetic approval driver | `gkos-gatekeeper-fixture` | absent |
| Published filesystem driver | `gkos-gatekeeper-fs` | `[]` |
| Published kernel | `gkos-kernel` | two `os_*`, three `gk_fs_*`, two `gk_mcp_demo_*` |

Filesystem worked because the kernel declared those specific names. The fixture
was absent before policy evaluation despite a healthy driver and owner-only grant.
Policy was `messaging`, `alsoAllow:[gkos-kernel]`, native denials unchanged, and
`plugins.allow` included the fixture. Adding its plugin ID to policy alone cannot
repair registration under the wrong plugin identity.

## Repair contract

- `defineGatekeeper()` validates the actual installed `openclaw.plugin.json` ID and
  exact `contracts.tools` set against the definition. The kernel catalog checks the
  same manifest against catalog metadata. Missing, duplicate, extra or mismatched
  declarations fail before admission.
- The **kit**, not vendor code, registers inert wrappers under each gatekeeper's
  upstream identity during full/discovery/tool-discovery. No driver receives an API.
  Wrappers delegate to the existing full kernel runtime slot at execution time;
  registration order cannot grant authority or require a pending-API registry.
- Kernel execution checks plugin/vendor/API/root/cell identity against the catalog,
  consumes the original call stash, and rechecks grant/audience/parameters. Shutdown
  and driver revocation fail closed. Kernel `os_*`, RPC, trusted-policy, and manifest
  surfaces are unchanged; no new vendor names are added to the kernel manifest.
- `gkos config apply` derives `tools.alsoAllow` gatekeeper IDs from enabled
  `os/gatekeepers.json` entries. The same derivation covers per-agent messaging
  policies. Removed/disabled catalog IDs disappear on the next apply; unrelated
  additions and every native denial are preserved. Catalog changes force a Gateway
  reload via restart even when the tool IDs themselves did not change.
- Explicit `tools.allow` ceilings and runtime cells are not widened. The runtime
  profile's allowlist and sandbox are unchanged. A gatekeeper blocked there stays
  blocked until a separate operator policy decision. Blueprint drift checks treat
  only the derived messaging gatekeeper IDs as catalog-owned, not blueprint drift.

## Installing/removing a catalog gatekeeper

Install the trusted plugin through the existing install-policy gate. Its manifest
must declare exactly its own tools. Configure its plugin load/allow/entry and add
its reviewed metadata/root to `os/gatekeepers.json`, then run `gkos config apply`
for that cell. Adding metadata does **not** issue a grant. To remove it, remove or
disable the catalog entry and its plugin configuration, then apply again. Do not
add its tools to the kernel manifest, use `group:plugins`, or weaken native denials.

The packed regression gate installs real tarballs, uses the installed CLI's pure
`mergeFragments` desired-state preview, and adds a separately owned synthetic driver
whose name is absent from the kernel manifest. It checks no-grant visibility,
filesystem grants, fixture approval apply/reject with actual effects and audit,
and revoked-grant hiding. The beta.4 negative control uses its shipped baseline
(no preview export), never a test-generated allowance. This focused regression is
not a third npm-only acceptance invocation or authorization for beta.5.
