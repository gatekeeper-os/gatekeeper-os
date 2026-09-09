# Security policy

## Reporting a vulnerability

Do not post credentials, exploit details, or private user data in a public issue.
Use this repository's **Security → Report a vulnerability** action when available.
If private reporting is unavailable, open an issue containing only a request for
a private security contact; wait for a maintainer-provided private channel before
sharing details. Do not assume an unsolicited contact is a maintainer.

Include the affected commit or release, platform, upstream version, and minimal
reproduction steps using disposable resources. Redact all credentials and
personal information. No response-time guarantee is currently offered.

## Support status

The project is pre-release. Release notes identify the tested upstream version,
platforms, limitations, and acceptance evidence for each published prerelease.
An unreleased branch is not a supported production version. No security audit
or independent certification is implied by passing automated tests.

## Trust boundary

The kernel mediates gatekeeper capabilities, grant scope, and action approval.
It does not make an arbitrary native plugin safe: native plugins execute code
inside the Gateway process. Install only trusted plugins and review install
policy changes. Use operator-controlled grants and isolated test accounts.

Report unexpected grant creation, scope expansion, approval bypass, credential
exposure, or fail-open behavior as security defects.
