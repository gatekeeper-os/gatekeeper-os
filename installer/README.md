# Installer evaluation

The beta CLI is on npm: `npm install --global @clawkeepers/cli@beta`.
`latest` currently resolves to `0.1.0-beta.1` because no stable release exists.
Use `clawos cell create evaluation --policy messaging` on a disposable machine;
a clean-prefix install/version smoke does not establish cell acceptance.

For source-install VM evaluation, obtain access to the private core repository,
clone it inside the disposable machine and run `./installer/install.sh`.
See [VM testing](../docs/vm-testing.md) for the acceptance harness and snapshots.
The source route remains supported; no unauthenticated `curl | bash` path is
available while the repository is private. Model credentials and channel setup
are separate, and the [documented limitations](../README.md#what-works-todayand-what-does-not)
remain in force. npm-only fresh-VM acceptance is a separate release gate.
