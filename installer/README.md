# Installer evaluation

After beta.2 is published, install the renamed CLI with: `npm install --global @gatekeeper-os/cli@beta`.
The new scope is not published yet. The old scope’s `latest` resolves to beta.1
because no stable release exists.
Use `gkos cell create evaluation --port 19100 --policy messaging` on a disposable machine;
a clean-prefix install/version smoke does not establish cell acceptance.

For source-install VM evaluation, obtain access to the private core repository,
clone it inside the disposable machine and run `./installer/install.sh`.
See [VM testing](../docs/vm-testing.md) for the acceptance harness and snapshots.
The source route remains supported; no unauthenticated `curl | bash` path is
available while the repository is private. Model credentials and channel setup
are separate, and the [documented limitations](../README.md#what-works-todayand-what-does-not)
remain in force. npm-only fresh-VM acceptance is a separate release gate.
