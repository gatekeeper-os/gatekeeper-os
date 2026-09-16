# Open-source beta release status

As of 2026-09-16, `gatekeeper-os/gatekeeper-os`, `gatekeeper-os/gatekeepers`
and `gatekeeper-os/.github` are public. Five packages are published at
`0.1.0-beta.5`: `@gatekeeper-os/{shared,gatekeeper-kit,kernel,gatekeeper-fs,cli}`.
Both `beta` and `latest` select that version; no stable release exists.

## Completed release checkpoints

- npm-only acceptance `20260916-220009-phase-3` passed on guest Node22.22.3 /
  OpenClaw2026.9.2: five registry identities/tags/times/archive SHA512, cell creation
  and selector, install-policy14/14, kernel-live114/114, selected conformance38/38,
  owner-only72/72, independent approval30/30; 25 local model turns /39 requests.
  No product source checkout/build/patch. Effects and audit were synthetic.
- Core [PR24](https://github.com/gatekeeper-os/gatekeeper-os/pull/24) merged the
  acceptance; community [PR9](https://github.com/gatekeeper-os/gatekeepers/pull/9)
  merged the real beta.5 Tier 1 registry lockfile.
- Trusted npm publishers are configured for all five packages against
  `gatekeeper-os/gatekeeper-os`, workflow `release.yml`.
- [Release run35157645735](https://github.com/gatekeeper-os/gatekeeper-os/actions/runs/35157645735)
  passed the public-source guard and gates; all five packages logged
  `already published, skipping`. No npm write was needed.
- All three main branches require strict, up-to-date `build-test`; rulesets
  .github23568975, core23568976, community23568977 prohibit force-push/deletion.
  Secret scanning and push protection are enabled on all three.
- [Community live sync35156945324, attempt2](https://github.com/gatekeeper-os/gatekeepers/actions/runs/35156945324)
  ran and passed anonymous core-main fetch/parity, not skipped.
  [PR13](https://github.com/gatekeeper-os/gatekeepers/pull/13) removed the temporary
  skip path after green CI35159265021; fetch/parity failures are now fatal.
- [GitHub beta.5 prerelease](https://github.com/gatekeeper-os/gatekeeper-os/releases/tag/v0.1.0-beta.5)
  and the annotated `phase-9` checkpoint are published. Phase9 is a release
  checkpoint, not a claim that every earlier full-phase acceptance gate passed.

## Remaining acceptance and distribution limits

Real filesystem writes stay disabled. Real messaging transports, real GitHub/MCP
driver acceptance and a ClawHub listing are not established. Phases5–7 have the
scoped runtime checkpoints in the [checklist](phase-checklist.md), not full
connected-provider/channel/update-matrix acceptance. No failed historical run
is reclassified by the beta.5 pass.

GHSA-22jj-m53c-524m was closed by OpenClaw maintainers on 2026-09-12 as requiring
no change: denied tools do not execute and logs/session transcripts are owned by
the operator on the operator's host. GatekeeperOS leaves synchronous approval off
by default for its own log hygiene, not pending upstream remediation. See the
[full disposition](../plans/upstream-native-approval-logging.md).

## License and ongoing release review

Original GatekeeperOS contributions remain MIT. Adapted and third-party material
retains its own terms, notices and attribution; see [provenance](acknowledgments.md)
and [NOTICE](../NOTICE). No relicensing is implied.

Future releases require fresh, exact-artifact evidence and explicit authorization.
Review source/history/assets for credentials and personal material, packed license
contents, compatibility pins, platform limits, and the vulnerability-reporting
route. A source secret-pattern scan alone is not a history audit. Keep legitimate
private reporting and owner-only resource boundaries even though the repositories
are public. This status document is not a command to publish or repeat a release.
