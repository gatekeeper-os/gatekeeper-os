# Real plugin secondary-hook fixture

The acceptance candidate is the **community** ClawHub code plugin
`mainctrl@1.1.0` (runtime id `mainctrl`). `candidate.json` pins the identity and
records public registry metadata observed on 2026-09-09: compatible API range
`>=2026.6.6`, clean/current security status, and the published archive digest.
The digest is a provenance reference, not a fabricated local hashing assertion;
upstream's supported install path performs its own registry integrity checks.

Run only through:

```sh
CLAWOS_VM_DRIVER=libvirt \
CLAWOS_VM_STATE_DIR=../phase-0-bootstrap/scripts/vm/.state \
  bash scripts/vm/test.sh phase-3 installed plugin-install-hook
```

The scenario uses a paired operator Gateway client and actual `plugins.install`
requests. The first request is blocked by the primary policy. The fixture then
independently allows the primary while leaving the real kernel deny-all. A passive
high-priority hook observes typed plugin material and verifies the exact staged
package name/version, manifest id, and declared entrypoint presence. The kernel
must deny the request with its real cell-policy reason, terminate lower-priority
hooks, leave config unchanged, leave no installed extension/inventory entry, and
mint no grants. The downloaded candidate is never enabled or run. No production
credentials, private upstream imports, upstream SQLite, or direct hook calls are
used.

## Source trust distinction

Pinned `openclaw@2026.9.2` calls ClawHub a trusted source for the CLI's source
confirmation prompt. That is **not** the same as secondary-hook exemption.
Read-only source inspection of `shouldBypassOpenClawInstallFriction` shows that
immutable **official** ClawHub/npm/git, source-linked official installs, and
OpenClaw-managed/bundled material may skip that hook. A nonofficial package from
default ClawHub gets source authority `openclaw` and kind `clawhub`, which does
not match the exemption. The real Gateway fixture establishes that distinction.
No gateway-path correction or upstream repin is needed.

## Retained diagnostic failures

- `20260909-224938-phase-3`: supported local-directory CLI install of the inert
  `install-policy-probe` blocks at primary, but after primary allow completes
  without secondary callbacks. Builtin `plugins` CLI does not load a plugin hook
  runtime. This is not secondary acceptance.
- `20260909-225144-phase-3`: community `openclaw-plugin-heygen@0.1.0` is compatible
  but upstream rejects its TypeScript entry because compiled runtime output is
  absent. The rejection happens before either policy boundary.
- `20260909-225429-phase-3`: first successful community Gateway fixture, 13/13
  checks.
- `20260909-225637-phase-3`: final focused pass: **14/14** actual scenarios and
  **14/14** fail-closed conformance tests, including exact staged material identity.
  Catalog and secret scans passed; VM shut down with snapshots unchanged.

Prior official Firecrawl controls and skill-only successes remain separate
historical evidence. Neither is substituted for plugin-hook coverage.
