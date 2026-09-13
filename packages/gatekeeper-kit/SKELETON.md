# Gatekeeper skeleton

Follow `.agents/skills/write-gatekeeper/SKILL.md` and its two operator reviews before implementing a driver.
The existing filesystem/GitHub packages remain placeholders, not working reference drivers.

## Package shape

```
packages/gkos-gatekeeper-<vendor>/
  openclaw.plugin.json   # id, empty contracts.tools, strict configSchema, gkos.gatekeeper marker
  package.json          # extension entry, pinned compat/catalog peer range
  deploy-inputs.json    # required secret references, never values
  src/index.ts          # defineGatekeeper declaration
  src/tools.ts          # GatekeeperToolDef metadata; required string grant on every tool
  src/vendor.ts         # account lifecycle, resource discovery
  src/account.ts        # validates operator access before producing a resource
  src/resource.ts       # KitGatekeeper subclass, actions and observations
  test/                 # offline queue/vendor fixtures; later live conformance
```

## Declaration and action implementation

`defineGatekeeper({ id, vendor, apiVersion: 1, name, description, resources, tools, actions, createVendor })` validates
metadata synchronously. The plugin id is `gkos-gatekeeper-<vendor>`; npm names
remain `@gatekeeper-os/gatekeeper-<vendor>`. `actions` maps every action tool name to a **pure `describe(params)`** descriptor. Reuse the
same descriptor when building the resource's `actions` table; this does not replace instance-level validation.
The builder requires names ≤64 ASCII characters, matching vendor namespaces, exact resource/tool mappings, explicit
observer strategies, a required string `grant`, and descriptions without `approv/oauth/cache/queue/simulat`.
It never receives an external service implementation through RPC and never calls `api.registerTool`.

The plugin manifest owns config validation; the builder does not replace that schema with an empty one.
`createVendor(ctx)` is called only in service `start`, never at import or discovery. `ctx` contains pluginConfig,
stateDir and a logger, **not** the OpenClaw registration API. Load the cell key privately within this lifecycle when
constructing `TokenStore`; never log it or return it. Store paths are below `<stateDir>/os/gatekeepers/<vendor>/`.
The kernel validates a slot against enabled catalog metadata, canonical cell/root and API version, then reaches a
resource **only via `resolveGrant()`**. Slots are trusted in-process transport, not a malicious-plugin sandbox.
Retained vendors/accounts/resources/sessions reject use after service stop or replacement. No service ordering assumed.

A per-resource instance extends `KitGatekeeper`, supplies `resource`, and initializes `overlay` after `super(journalPath)`.
Use one live resource instance per journal path. The optional journal and sequence paths make pending actions and IDs
survive restart. `new OverlayStore(overlayPath)` supplies persistent effects. An omitted path is explicitly ephemeral.
Do not reuse a journal path for a different resource, account or implementation version.

```ts
// Inside the resource class; describeWrite is also referenced by the declaration's actions table.
observations = {
  gk_example_item_get: {
    describe: () => ({ title: "Read item", description: "Read the introduced item." }),
    read: async () => this.overlay.applyTo(await this.api.read(), this.reducers),
  },
};
actions = {
  gk_example_item_put: {
    describe: describeWrite, // returns ActionDescription, including truthful implementsRevert
    simulate: (params, overlay, actionId) => {
      overlay.add({ actionId, kind: "put", payload: params.value });
      return { written: true };
    },
    apply: async (params, actionId) => {
      // Use actionId as the vendor idempotency key where supported.
      const item = await this.api.write(params.value, actionId);
      return { remoteId: item.id, value: { written: true } };
    },
    revert: async ({ remoteId }) => { await this.api.undo(remoteId); },
  },
};
```

Only return selected, credential-free result fields from vendor adapters. Raw vendor responses are not safe tool results.
Reducers must be deterministic and side-effect-free; `simulate` modifies only local stores. Every deferred action must
add exactly one overlay entry using the supplied actionId; never invent action IDs. `describe()` must perform no I/O.
A resource must invalidate/refresh its authoritative read cache after remote application/revert so retiring an overlay
does not expose stale data. CacheMutationStore's `commit(id, freshBase)` performs this local transition for that strategy.

## Ordering and recovery

The kit authorizes observations **before** fetching and rechecks session liveness before returning. A dry pass calls
only `describe`; it never fetches, reserves an ID, submits or simulates. Real actions reserve an ID and journal the
submission, await the kernel queue, then simulate. `applyAction` is operator-only through the kernel and single-flight;
earlier undecided actions must be resolved first. Repeated successful apply/reject/revert calls do not repeat effects.

For unsimulated actions set `awaitDecision: true`. The kernel must supply `SessionCallContext.actionApproval` retained
from the authenticated hook decision, with the exact tool, validated parameters and toolCallId. Missing/mismatched
approval denies before submission. Never copy this field out of model parameters. The kit does not itself implement
OpenClaw's approval UI or authorization adapters; their live conformance is Phase 3/4 work.

Journal and kernel queue are separate stores. A crash between submission records, a failed remote write, or an interrupted
apply/revert is **uncertain**, not safe to replay. Such a resource fails closed until the operator reconciles its actual
state. No exactly-once guarantee across arbitrary vendor APIs is claimed. Pending overlays survive restart and are
rebuilt if missing; effects of terminal records are discarded on new sessions. File helpers assume a single cell process
owns each instance; they are not a cross-process transactional database. The kernel must enforce that ownership.

## Authentication and helpers

- The kernel OAuth router owns `OAuthNonceMachine`: `issue(binding)` → `advanceBound(firstNonce)` → `consume(callbackNonce)`. Both stages are single use, and the original ten-minute expiry is preserved. Do not create a parallel nonce store in a vendor. `connectAccount` receives the kernel state and fixed callback path; `completeConnection` performs provider account/PKCE checks, exchanges the code, and stores encrypted credentials before returning. The vendor resolves its callback only against its configured public origin. Keep authorization redirects private and out of logs. Real provider integration is Phase 4.
- `TokenStore(dir, cellKey)`: atomic AES-256-GCM files with hashed account filenames and account/store-bound authentication.
  `get` returns null for absence, throws a fixed error for corruption. `refresh` coalesces; `remove`/`put` invalidate stale
  refreshes. Moving the encrypted store to a different canonical path requires explicit re-encryption or reconnection.
- `OverlayStore`: pending effects merged at read; `CacheMutationStore`: retain base and rebuild the mutable cached view
  after rejection/refresh. Persist only selected simulation fields, never credentials.
- `ActionSequencer`: durable IDs and serialized local work. `sanitizeError` emits only a fixed string and numeric status.
- `TestApprovalQueue`: offline test fixture only. It is not a production queue, authority, or live conformance result.

v1 remains private-only. Declaring a low-stakes/ACL observer strategy does not itself authorize shared access.
Run `scripts/vm/test.sh phase-2` for library acceptance; a real driver also needs its later-phase VM conformance.
