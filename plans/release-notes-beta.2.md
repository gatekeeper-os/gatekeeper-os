rename to GatekeeperOS; no functional change

- GitHub: gatekeeper-os/gatekeeper-os, gatekeeper-os/gatekeepers, gatekeeper-os/.github.
- npm: @gatekeeper-os/{shared,gatekeeper-kit,kernel,gatekeeper-fs,cli}@0.1.0-beta.2.
- Standalone CLI gkos; owned environment prefix GKOS_; plugin ids gkos-kernel and gkos-gatekeeper-*.
- gk_* tools, os.* RPC methods, openclaw os, grant handles and stateDir/os layout unchanged.
- Independent-project disclaimer added; Cloudflare OS attribution and NOTICE retained.

No new functional acceptance is claimed. Real filesystem writes stay disabled;
real messaging and all previously documented unproven paths remain unproven.
The beta.1 npm-only run stopped on harness config validation after 14/14 install
policy checks, before kernel/audience/approval stages (0 model turns). Beta.2
npm-only VM acceptance and the community registry switch follow Matt's publication.

Private preparation only: no publication, visibility flip, tag push, trusted
publisher setup, release-workflow rerun, phase tag, or upstream post.
