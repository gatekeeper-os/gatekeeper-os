# Installer evaluation

Install the published beta on a disposable machine with Node22.22.3+:

```sh
npm install --global @gatekeeper-os/cli@beta
gkos cell create evaluation --port 19100 --policy messaging
```

All five release packages are `0.1.0-beta.5`; both `beta` and `latest` select
that version. There is no stable release. npm-only messaging-cell acceptance
passed in `20260916-220009-phase-3` on Node22.22.3 / OpenClaw2026.9.2.
Successful approval effects were synthetic, not real filesystem/provider writes.

For source evaluation, clone the public core repository inside a disposable
machine and run `./installer/install.sh`. The source route remains supported;
no standalone `curl | bash` installation is advertised as accepted.
Model credentials and channel setup are separate. See [VM testing](../docs/vm-testing.md)
and [release limits](../README.md#release-status).
