Real filesystem apply under the cooperative-writer contract; kernel-owned drivers for OpenClaw 2026.9.5+

**Filesystem writes.** Once an operator approves a `gk_fs_file_write` action, it is now applied to disk, under the
[2026-09-27 contract amendment](fs-contract.md#amendment-2026-09-27--cooperative-writer-adversary-model-for-apply).
The driver reaches the target through a no-follow descriptor walk that must stay on the grant root's mount. It refuses
special, multiply linked, oversized, non-text, setuid or foreign-owned targets, and any target whose identity or content
hash changed since the write was requested. It then journals the preimage, stages beside the target, rechecks the
baseline, publishes, verifies, fsyncs, and records an effect receipt. Replacements use `RENAME_EXCHANGE` through an
optional system `exch`/`mv --exchange` when present, otherwise `rename`; new files use `link()` and never replace an
existing name. Ambiguous outcomes are `uncertain`: files, intent and preimage are kept, and the resource is blocked
across restarts until reconciled. Revert restores the preimage of a replaced file, and only while that file is unchanged.

Limits: no race-safety against a hostile process running as the Gateway's user is claimed (CE-1, parent relocation, is
detected, not prevented). An edit landing between the final check and the publishing syscall is lost in `rename` mode
(stock Ubuntu 24.04) and detected, with both versions kept, in `exchange` mode. Revert of newly created files is not
implemented. Reconciliation of `uncertain` actions is manual.

**Kernel-owned drivers (breaking kit API).** OpenClaw 2026.9.5 made SDK runtime slots private to each plugin. The
kernel now loads each enabled driver itself from `gkos.gatekeeper.driver` in the validated catalog root, and executes
gatekeeper tools in tool-result middleware. The root `@gatekeeper-os/gatekeeper-kit` entry never imports `openclaw`,
and `defineGatekeeper` moved to `@gatekeeper-os/gatekeeper-kit/plugin`. Drivers export `defineGatekeeperDriver({...})`
from `src/driver.ts`, and `src/index.ts` becomes `export default defineGatekeeper(driver)`. The plugin manifest needs
`gkos.gatekeeper.driver: "./dist/driver.js"`. `gatekeeperRuntimeSlot`, `kernelToolRuntimeSlot` and
`GatekeeperRuntime` are removed. Verified on OpenClaw 2026.9.2, 2026.9.4 and 2026.9.6.

**Package READMEs.** The CLI, kernel and filesystem READMEs no longer say filesystem writes are disabled. The kit
README documents the driver/plugin entry split. Distribution sections no longer say beta.5 is current.

Five release packages and all internal dependency pins move to 0.1.0-beta.6. The OpenClaw pin (2026.9.2), compat range
and kernel schema are unchanged.

Evidence before publication: VM checkpoint `20260927-051331-phase-3` (guest Node 22.22.3, kernel 6.8.0, ext4,
`rename` mode) covering real write, refusal, CE-2 detection, revert and bind-mount refusal. The packed model-turn gate
ran 10 turns on the beta.6 archives: no-grant tools, filesystem grant, the registrant-independent backstop,
independent-gatekeeper approve/reject/revoke, a filesystem create and replace that each land with a matching receipt,
a rejected write that never lands, `uncertain` blocking, and native denials. npm-only acceptance of the published
beta.6 has not run yet; the prepared harness follows publication. Real connected-provider and chat-transport
acceptance are not established. See the [threat model](../docs/threat-model.md).
