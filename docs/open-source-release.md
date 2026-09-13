# Open-source beta publication

Recorded 2026-09-09: the intended beta will be published as open source, with a
thorough project introduction and explicit acknowledgment of OpenClaw and
Cloudflare OS. A separate GitHub organization is a possibility, not a completed
decision. The current development repository remains private.

## License decision

**Current decision: retain MIT for original GatekeeperOS contributions.** MIT was
already confirmed during beta authorization and is implemented in the root
license, package metadata and package copies. This continuation does not silently
change that decision.

| Option | Practical distinction |
|---|---|
| **MIT — current recommendation** | Simple permissive reuse, modification and commercial redistribution; retain copyright and license notices. No express patent-license clause. |
| Apache-2.0 | Also permissive, with an explicit contributor patent grant and patent-litigation termination terms; more detailed notice and modification obligations. |
| AGPL-3.0 | Strong copyleft, including source-offer obligations for users interacting over a network with modified versions; choose only if that reciprocity is an intentional project goal. |

Both MIT and Apache-2.0 allow commercial and closed-source downstream use. If the
goal changes to stronger patent provisions or reciprocal source availability,
revisit the choice deliberately before publication. No such change is made here.
Third-party material retains its own terms regardless of the project's choice;
see [provenance](acknowledgments.md) and [NOTICE](../NOTICE).

## Publication checks

These checks prepare distribution; they do not replace the original phase plan,
waive any acceptance gate, or turn pre-beta code into a completed beta.

- [ ] Complete remaining Phase 4–7 implementation and acceptance with real evidence;
  keep any explicitly authorized deferral visible in release notes.
- [ ] Reconcile release-hardening requirements from the original plan with the
  actual beta artifacts; no placeholder publishing script is a release mechanism.
- [ ] Refresh README examples against the exact beta candidate; verify installation
  from the source archive and any package format actually offered.
- [ ] Review source, git history, release assets and CI artifacts for credentials,
  private conversations, personal host details and material not authorized for
  public distribution. A source secret-pattern scan alone is not a history audit.
- [ ] Finish the provenance/dependency review, preserve upstream notices and
  modified-file attribution, and check packed/bundled license contents.
- [ ] Publish tested-platform and upstream-pin details, known limits, changelog
  and acceptance references that public readers can actually access. Do not link
  private VM paths as though evidence were public.
- [ ] Verify a usable private vulnerability-reporting route and contribution guidance.
- [ ] After the separately authorized public flip, re-run gatekeepers `build-test`
  and confirm **Live core-main fetch and parity (required when readable)** ran and
  passed, not skipped. Verify anonymous access without credentials before removing
  the temporary private-core skip path. Pinned-snapshot parity is not live-sync evidence.
- [ ] Select the destination organization/repository and finalize public branding.
- [ ] Publish only the reviewed beta candidate after readiness is verified; do not
  infer authorization to publish incomplete work from the future release intent.

## Possible GitHub organization

No organization name is reserved, no organization has been created, and no
repository has been transferred. The name should make the project's independence
clear and avoid implying it is the official OpenClaw or Cloudflare organization.

Once the owner chooses the destination, prepare the transfer as a concrete change:

- Establish organization ownership, recovery and least-privilege maintainer roles.
- Check repository transfer effects on Actions, branch protections/rulesets,
  integrations, security reporting, secrets, package ownership and release rights.
- Update repository/package metadata, installer and documentation links, badges,
  workflow references and support contacts; verify old-link redirects separately.
- Decide whether the existing `@gatekeeper-os/*` package namespace is available and
  appropriate; a GitHub organization does not reserve an npm scope.
- Verify the destination, visibility and access after transfer, then test the
  published installation instructions from a clean environment.

Do not rename or transfer the development repository merely to make draft links
look final. Keep development moving while naming is unresolved.
