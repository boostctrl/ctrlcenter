# Security Policy

## Supported versions

ctrlcenter ships as a rolling release. Only the latest published version (see
the [releases page](https://github.com/boostctrl/ctrlcenter/releases)) receives
security fixes. Please make sure you can reproduce an issue on the latest
release before reporting it.

## Reporting a vulnerability

**Please report security issues privately — do not open a public issue or PR.**

Use GitHub's private vulnerability reporting:
[**Security → Report a vulnerability**](https://github.com/boostctrl/ctrlcenter/security/advisories/new).

Helpful details to include:

- affected version and how ctrlcenter is deployed (reverse proxy, direct, etc.),
- a description of the impact and the steps to reproduce,
- any proof-of-concept or logs.

We aim to acknowledge a report within a few days and will keep you posted as we
work on a fix. Once a fix ships we're glad to credit you in the release notes,
unless you'd prefer to stay anonymous.

## Deployment expectations

ctrlcenter is designed to run **behind a reverse proxy** that terminates TLS and
is the public entry point. A couple of settings matter for a safe deployment:

- Set a strong `ADMIN_PASSWORD` (or configure a password in the admin portal).
- Set `TRUSTED_PROXY_HOPS` to match your proxy chain — in particular, set it to
  `0` if you expose ctrlcenter directly with no proxy, so a client can't spoof
  `X-Forwarded-For` to bypass the per-IP login throttle.

See the [README](README.md) for the full configuration reference. Findings that
require an already-compromised host, or a configuration the docs explicitly warn
against, may be considered out of scope.
