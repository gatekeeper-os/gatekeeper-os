# MCP gatekeeper — concrete STOP1 contract

Status: **STOP1 approved by Matt: “Approved continue”, 2026-09-12.**
**STOP2 approved by Matt on 2026-09-12** for responsibilities4–7.
The active runtime surface is narrowed to the reviewed observation; native actions
remain unregistered and hard-gated by the upstream logging issue. This is the next item in Matt's overnight order after
Phase7, Phase5 and Phase6, not full Phase8 or beta acceptance.

## Approved STOP1 decision

Approve the following initial boundary: **HTTPS Streamable HTTP only**, individually
named tools compiled from an operator-reviewed per-server manifest, and owner-only
server grants using the logical URL convention below. The second review was approved on 2026-09-12 before approval/cache/observer implementation. Stdio execution,
per-tool grants and arbitrary discovery are excluded from this first slice.

## Exact grant identifiers

- Pattern: `https://mcp.clawkeeper.invalid/servers/:server`
- Example: `https://mcp.clawkeeper.invalid/servers/demo`
- Server IDs: lower-case letter followed by zero to15 lower-case letters/digits.
- This reserved `.invalid` URL is **an identifier, never a fetch destination**.
  It maps to an already configured server and cannot introduce a new endpoint.
- Only byte-exact canonical known identifiers are accepted: no credentials, ports,
  query, fragment, slash suffix, encoded separators, dot traversal or alternate host.
- One grant covers only the reviewed tool subset for that server/account. An
  unconfigured server ID, tool or credential binding is denied, not provisioned.
- No cross-server, cross-account, cross-agent or shared-audience access. Grant and
  account revocation invalidate retained sessions. Per-tool grants are deferred.

Logical identifiers avoid treating a server-advertised endpoint or description as
operator authorization. This is a deliberate design choice for review, not an
established ecosystem URL convention. No kernel URL matcher is changed at STOP1.

## Agent-facing surface

Every reviewed upstream tool gets one fixed name `gk_mcp_<server>_<alias>`; server
IDs contain no underscores and aliases are lower-case letter followed by up to31
letters/digits/underscores. Names remain <=64 characters. Duplicate or ambiguous
names are rejected, not truncated or silently renamed. Resource type is
`server_<server>`. Kernel contract metadata must contain the exact reviewed names;
no generic MCP invocation bypass or arbitrary plugin registration is proposed.

The synthetic notes manifest makes the design concrete; it is **not** a real
service connection or a promised general-purpose notes product:

| Agent tool | Bound upstream method | Kind | Inputs besides grant | Selected output |
| --- | --- | --- | --- | --- |
| `gk_mcp_demo_read_note` | `notes.get` | observation | `noteId`:1–128 alnum/underscore/hyphen | noteId, bounded text, revision, explicit truncation |
| `gk_mcp_demo_append_note` | `notes.append` | action | same noteId; text1–8192 chars | noteId, revision, confirmed append status |

The closed parameter schemas in `packages/gatekeeper-mcp/src/tools.ts` contain
no tool selector, endpoint, headers, credentials, subprocess command, or resource
URL. Tool descriptions are operator-reviewed operation descriptions, not copied
server prose. `upstreamName` is binding metadata, never a model-controlled argument.

## Per-server review and discovery rules

An operator-owned manifest binds server ID, exact HTTPS endpoint, account-auth
reference, tool aliases/classification, full closed input/output schemas, bounded
response projection and action policy. At most16 servers and32 tools/server are
proposed for the first implementation. No secret values live in this manifest.

`tools/list` may be used later to **verify** the reviewed inventory and schema
fingerprints. It never automatically publishes tools or supplies policy. A missing,
changed, reclassified or extra tool is drift requiring review; changed schemas do
not silently gain authority. MCP readOnly/destructive/idempotent annotations are
untrusted hints, not permission or proof of safety. Parameter and output schema
support must be explicitly bounded; do not accept arbitrary schemas or callbacks.

## Reviewed transport/account boundary

Initial scope is HTTPS Streamable HTTP, fixed operator-configured origins, bounded
messages/timeouts, no implicit redirects or arbitrary URL fetching, and no
localhost/link-local/private-network destinations by default. A fixture-only
loopback exception must be separate and never enable production private-network
access. HTTPS endpoint trust does not confer trust in tool content.

Use supported public MCP APIs and the existing kernel-owned account/OAuth lifecycle
and encrypted TokenStore where applicable; no second nonce machine or token in a
prompt, argument, log or URL. Auth configuration/issuer/scopes must be reviewed per
server. Do not reuse host MCP credentials implicitly or dynamically register an
OAuth client from server instructions. A server grant requires operator-bound
account access validation, not merely a successful unauthenticated handshake.

Stdio/subprocess launch, legacy SSE, arbitrary resources/read, prompts/get,
elicitation, server-side sampling, server-initiated client tools and automatic
resource-link fetching are excluded initially. Connection liveness/schema checks
alone do not make any tool an observation or safe to execute.

## Approved action/observer behavior — native execution still gated

All observations await the existing queue authorization and recheck liveness before
returning only explicitly projected fields. Returned text is untrusted data, never
instructions or newly granted resources. Owner-only/private observer policy is the
initial default, not an assertion that MCP defines a universal ACL oracle.

For generic MCP actions, simulation/revert cannot be inferred. Default proposal:
`awaitDecision:true`, `autoApprovable:false`, `implementsRevert:false`. If a reviewed
server-specific adapter supplies honest deterministic simulation/revert, it needs
its own concrete review and tests. The synthetic append example promises neither
simulation nor generic deletion/revert. Network failure after a write is uncertain
and nonretryable until operator reconciliation; MCP request IDs are not guaranteed
vendor idempotency keys.

Native action execution remains blocked by the already confirmed upstream denied/
no-route body-logging issue until a supported fix passes secrecy acceptance. Neither STOP approval waives this or authorizes runtime publication.

## Evidence required after review

1. Exact resource/account/grant binding and revocation; no cross-server widening.
2. Inventory/schema drift, unknown params/methods and alternate endpoint denial.
3. Model-driven observation plus real upstream native allow/deny/no-route handling.
4. No effects before approval; no replay after uncertain effects; truthful revert.
5. Audit/file/console/body/credential secrecy, including server errors and notices.
6. Bounded/disconnected/malicious server behavior and all excluded client requests.
7. Existing kernel/fs regression and actual disposable-VM conformance.

At the original STOP1 checkpoint, offline tests covered only proposal metadata,
canonical identifiers and an inert entrypoint. New connection-boundary evidence
is recorded separately in [mcp-stop2.md](mcp-stop2.md) and PROGRESS.md.

## Historical STOP1 boundary

[write-gatekeeper/SKILL.md](../.agents/skills/write-gatekeeper/SKILL.md) states:
“STOP 1 — present the tool surface and URL patterns for operator review” and
“do not proceed past either without operator approval.” The generic overnight
request preceded this specific MCP surface. This artifact supplies the concrete
review; no vendor/account/transport, catalog activation or action implementation
has been added. Historical filesystem/GitHub approvals remain unchanged.

## STOP1 continuation

Matt approved this contract on 2026-09-12. The implemented connection boundary and
remaining concrete review are recorded in [mcp-stop2.md](mcp-stop2.md). JSON-only
Streamable HTTP is the supported subset; other transports deny. The initial compiled surface remains demo only, not an arbitrary
server discovery service. STOP2 subsequently approved the read-only runtime and
synthetic deferred-fixture evidence; append remains excluded from runtime tools.


## STOP2 implementation scope (2026-09-12)

- Active production tool: `gk_mcp_demo_read_note` only. The reviewed append mapping
  remains in inventory validation, but not in vendor tools/resource metadata.
  This prevents the kernel from entering upstream native approval before our
  execution callback. The kernel manifest reserves both names for declared
  metadata and VM fixture coverage; it does not itself register append.
- Reads authorize before I/O and immediately before release, recheck account and
  session liveness, validate inventory on the same pinned TLS connection, project
  `noteId`, text≤8192, nonnegative integer revision and explicit truncation, and
  refresh a single bounded cache document under the account-bound resource store.
  Failed refreshes never return stale data; all sharing denies (strategyA).
- Generic `ActionImpl` retains `awaitDecision:true`, `autoApprovable:false`,
  `implementsRevert:false`, no simulate/revert, and unconditional apply denial.
  No generic deferred protocol, guessed undo or fake append success is introduced.
- `src/testing/notes-fixture.ts` is **test-only**, never imported into the production
  bundle and never selectable by plugin configuration. Its synthetic in-memory
  notes append has deterministic concatenation/revision semantics, truthful
  deferred simulation (`awaitDecision:false` only in that adapter), overlay replay
  after refresh/restart and standard kit apply/reject/uncertain journals. It does
  not claim generic MCP simulation, a real server effect, or native acceptance.
- No full acceptance: native allow/deny/no-route tests remain gated; only deferred
  synthetic Gateway evidence and production observation/transport tests qualify.
