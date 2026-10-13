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

- Set a strong `ADMIN_PASSWORD` (or configure a password in the admin portal;
  one set there must be at least 12 characters).
- Terminate TLS at the proxy. Over HTTPS the session cookie carries the
  `__Host-` prefix, and `HSTS=1` has the app add `Strict-Transport-Security`
  if the proxy doesn't.
- Set `TRUSTED_PROXY_HOPS` to match your proxy chain — in particular, set it to
  `0` if you expose ctrlcenter directly with no proxy, so a client can't spoof
  `X-Forwarded-For` to bypass the per-IP login throttle. With `0`, the Docker
  image throttles each client by its real connection address.
- Consider turning on **two-factor authentication** (Settings → Security),
  especially if the portal is reachable beyond a network you fully trust.
- Point an alert channel at somewhere you'll see it and leave its
  **Security** events on: a sign-in from a new address, a lockout, the second
  factor or password changing and dashboard actions turned on are sent
  there, and Settings → Security keeps the recent activity.

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
  An env-held credential is only ever sent to the URL saved for that service:
  **Test connection** against a different URL uses just what's typed in the
  form, and changing the saved one — or an API widget's request, a
  calendar's address or an email channel's mail server — asks for your
  password again. `${ADMIN_PASSWORD}` and `${SESSION_SECRET}` never expand.
- **Assume each service key is all-powerful.** Sonarr, Radarr, qBittorrent, and
  most others expose a single unscoped API key or a full-control account, which
  ctrlcenter cannot narrow. Treat every configured credential as full access to
  that service, and give the integration the least privilege the service itself
  allows (a read-only or limited role where one exists, e.g. UniFi or Portainer).
- **Write actions are opt-in, off by default, and need two-factor
  authentication.** qBittorrent, Seerr, and Portainer can act from the Monitor
  page (pause/resume/delete torrents, approve/deny requests, start/stop/restart
  containers, and a read-only log tail), but only after you turn on "Allow
  actions from the dashboard" for that integration — which itself needs
  two-factor authentication on — until then it stays read-only. Every action
  passes five gates (the admin-only proxy prefix, a route session re-check,
  the integration being configured, the opt-in flag, and the second factor
  being on), is confirmed before anything destructive, and is logged on the
  server. Turning two-factor authentication off turns actions off with it. Leave the opt-in off for any integration you only
  want to observe, and remember that an action-enabled key needs write access to
  its service, not just read.
- **Firewall the container to just the services it monitors.** ctrlcenter
  fetches the base URLs an admin configures, and the admin-only "Test
  connection" button will attempt a connection to any `host:port` an admin
  enters. Restrict the container's egress to the specific service addresses it
  needs rather than the whole LAN/VLAN, so a mistaken or malicious URL can't be
  turned into a way to probe the rest of your network.
- **Exposing the portal to the internet.** A VPN or tunnel (Tailscale,
  WireGuard, Cloudflare Tunnel) is still the smallest attack surface, but a
  public port is a supported deployment: open **Settings → Security** and
  clear every red row of the checklist first — two-factor authentication on,
  a password set in the portal, HTTPS, `TRUSTED_PROXY_HOPS` matching your
  proxy, a persisted session secret — and keep a Security alert channel
  pointed somewhere you'll see it. With those in place a stolen admin session
  ends when you sign it out (or on its own after the idle timeout), and
  can't change the password, turn the second factor off, change where an
  integration's credentials are sent, export them, restore a backup or run
  a destructive action without the password again; a sign-in from an
  address not seen in a month is announced on your Security channels. The
  remaining exposure is what a session can read in its window: the Monitor
  page, the integrations' addresses and the credentials stored in
  `config.yaml`, which the admin's forms show. So keep secrets in
  environment variables, which the admin never shows, and give each
  integration the least privilege its service allows (both above).
- **Exports leave secrets out unless you ask.** `Export` writes a backup
  without integration credentials, calendar and email credentials or webhook
  tokens; restoring it onto the same instance keeps the ones stored there.
  Ticking **Include secrets** writes them in plaintext (after confirming your
  password), so a full backup can be restored elsewhere — store that file, and
  `config.yaml` itself, as you would any secret. The admin password hash and
  the two-factor secret are **never** exported.
- **Keep credential managers out of the dashboard.** Don't point ctrlcenter at a
  secrets or password manager (e.g. Vaultwarden/Bitwarden); aggregating that
  behind one admin session is exactly the concentration of risk to avoid, and
  there is no integration for it by design.
