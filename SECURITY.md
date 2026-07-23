# Security Policy

## Supported versions

ctrlcenter ships as a rolling release. Only the latest published version (see
the [releases page](https://github.com/boostctrl/ctrlcenter/releases)) receives
security fixes. Please make sure you can reproduce an issue on the latest
release before reporting it.

## Reporting a vulnerability

**Please report security issues as GitHub issues:**
[**open a new issue**](https://github.com/boostctrl/ctrlcenter/issues/new) and
apply the `security` label. Keeping reports in the open tracker keeps triage,
discussion, and the fix in one visible place.

Helpful details to include:

- affected version and how ctrlcenter is deployed (reverse proxy, direct, etc.),
- a description of the impact and the steps to reproduce,
- any proof-of-concept or logs.

If you believe a finding is too sensitive to post publicly (for example, it's
trivially exploitable against typical deployments), you may instead use
GitHub's private reporting:
[Security → Report a vulnerability](https://github.com/boostctrl/ctrlcenter/security/advisories/new).

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
- Consider turning on **two-factor authentication** (Settings → Security),
  especially if the portal is reachable beyond a network you fully trust.

See the [README](README.md) for the full configuration reference. Findings that
require an already-compromised host, or a configuration the docs explicitly warn
against, may be considered out of scope.

## Running with integrations enabled

The private Monitor page can connect to other self-hosted services (qBittorrent,
Sonarr/Radarr, AdGuard Home, TrueNAS, UniFi, Tautulli, Seerr, Portainer). Those
connections hold credentials and reach into your internal network, so a few
practices matter. Integration data and the routes that fetch it are admin-only
and never render on any public page — these steps keep the surrounding
deployment safe.

- **Keep secrets in the environment, not the config file.** Every integration
  credential can come from a `CTRLCENTER_<SERVICE>_*` environment variable
  instead of `config.yaml` — leave the field blank in the admin. That keeps the
  secret out of the file, out of backups, and out of the config volume. The
  full list is in the environment-variable table in the [README](README.md).
- **Assume each service key is all-powerful.** Sonarr, Radarr, qBittorrent, and
  most others expose a single unscoped API key or a full-control account, which
  ctrlcenter cannot narrow. Treat every configured credential as full access to
  that service, and give the integration the least privilege the service itself
  allows (a read-only or limited role where one exists, e.g. UniFi or Portainer).
- **Firewall the container to just the services it monitors.** ctrlcenter
  fetches the base URLs an admin configures, and the admin-only "Test
  connection" button will attempt a connection to any `host:port` an admin
  enters. Restrict the container's egress to the specific service addresses it
  needs rather than the whole LAN/VLAN, so a mistaken or malicious URL can't be
  turned into a way to probe the rest of your network.
- **Don't expose a dashboard with integrations to the internet.** The routes are
  admin-only, but the blast radius of a stolen admin session grows once
  integrations are configured (and more so when write actions arrive in a later
  release). Reach the portal over a VPN or tunnel (Tailscale, WireGuard,
  Cloudflare Tunnel) rather than a public port. If it must be publicly
  reachable, turn on two-factor authentication and keep it behind the reverse
  proxy with a strong password.
- **Exported backups contain your secrets.** `Export` (and `config.yaml`
  itself) includes integration credentials and the other settings secrets in
  plaintext, so a backup can be restored. Store exported files as you would any
  secret. The admin password hash and the two-factor secret are **not**
  exported.
- **Keep credential managers out of the dashboard.** Don't point ctrlcenter at a
  secrets or password manager (e.g. Vaultwarden/Bitwarden); aggregating that
  behind one admin session is exactly the concentration of risk to avoid, and
  there is no integration for it by design.
