# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release groups changes under **Added**, **Changed**, **Deprecated**,
**Removed**, **Fixed**, and **Security** (only the relevant sections appear).
The notes published with each GitHub release mirror that version's section
here.

## [Unreleased]

### Added

- Change the admin password from the UI (Settings → Change password). The new
  password is stored hashed (PBKDF2-SHA-256, per-password salt) in the config;
  `ADMIN_PASSWORD` becomes the bootstrap/fallback credential. Changing it
  requires the current password even with a valid session.
- Custom search engine for the search bar (Settings → Search bar engine):
  choose DuckDuckGo, Google, Bing, Brave, or a custom `%s` URL template.
  Pressing Enter opens the top match, or searches the web when nothing matches;
  the no-results state offers an explicit "Search … for …" link.
- Auto-detected, per-visitor location and time zone. The header detects each
  visitor's time zone automatically and (when the weather widget is on) their
  approximate location by IP, with a discreet editor — click the time/location
  line — to correct the time zone, switch units, or use precise device
  location. Preferences are stored per-browser and never change the shared site
  config, so any visitor can fix their own view.

## [0.2.1] - 2026-06-20

### Security

- App and bookmark URLs are now restricted to `http(s)`. `javascript:`, `data:`,
  and `vbscript:` schemes were previously accepted and, rendered as links on the
  public dashboard, could have been stored XSS.
- Session signing now fails closed: if neither `SESSION_SECRET` nor
  `ADMIN_PASSWORD` is set, the app refuses to sign or verify sessions rather than
  deriving a key from an empty string (a known value that could forge sessions).
- Added security response headers — Content-Security-Policy, `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- The public `/api/status` endpoint now caches results briefly so it can't be
  hammered to amplify outbound pings.

## [0.2.0] - 2026-06-20

### Added

- Configurable accent color (Settings → Accent): pick from a set of presets
  that recolor the gradient heading, primary buttons, focus rings, and
  background glow via CSS variables, applied server-side (no flash).
- Service status indicators: an optional setting that shows an online/offline
  dot on each application card, backed by a server-side `/api/status` check
  that pings the configured app URLs.
- Config import/export in the admin header: download the whole configuration
  as JSON for backup, and restore it by importing a file (validated before it
  replaces the current config).

### Changed

- Reordering apps and bookmarks now works on touch and via the keyboard, using
  accessible up/down buttons alongside the existing mouse drag-and-drop.
- Admin feedback now uses toast notifications instead of inline text, and
  validation errors are shown as readable messages rather than raw JSON.

## [0.1.3] - 2026-06-20

### Changed

- The container now fixes ownership of the bind-mounted `/config` volume on
  startup (via an entrypoint that chowns the mount, then drops from root to the
  non-root app user with `su-exec`). Self-hosters no longer need to `chown`
  `./config` to uid `1001` by hand — read/write works regardless of the host
  directory's original owner.

## [0.1.2] - 2026-06-19

### Fixed

- Docker reachability: the standalone server now binds all interfaces via
  `HOSTNAME=0.0.0.0` instead of the Docker-assigned container-ID hostname,
  which could leave the published port unreachable and the healthcheck
  failing.
- First-run `docker compose up` no longer aborts on a missing `ADMIN_PASSWORD`:
  the `.env.example` referenced by the quick start is now included (it had been
  excluded by `.gitignore`).
- `/admin` save failures from bind-mount permissions are now documented — the
  container runs as uid/gid `1001`, so the `./config` directory must be owned
  by that user.
- The web app manifest and browser favicon now resolve to a bundled SVG app
  icon instead of a non-existent `/favicon.ico`.

## [0.1.1] - 2026-06-19

### Added

- Automated release notes: the release workflow now publishes the GitHub
  release from the matching `CHANGELOG.md` section.

### Fixed

- Admin login on plain-HTTP deployments. The session cookie is now marked
  `Secure` based on the request protocol (honoring `X-Forwarded-Proto`)
  rather than `NODE_ENV`, so browsers no longer drop it on non-HTTPS,
  non-localhost origins such as `http://<nas-ip>:3000`.

## [0.1.0] - 2026-06-19

Initial release.

### Added

- Self-hosted dashboard with an applications grid and bookmarks grouped by
  category.
- Header showing the localized date, a time-of-day greeting, and a
  live-ticking clock.
- Weather widget powered by Open-Meteo, with configurable location and
  imperial/metric units.
- Instant client-side search across applications and bookmarks (`/` to focus,
  `Esc` to clear).
- Drag-to-reorder for applications and bookmarks in the admin UI.
- Password-protected admin UI for managing applications, bookmarks, and
  settings, backed by a single `config.yaml` file.
- Signed-cookie admin sessions with an optional dedicated `SESSION_SECRET`,
  and per-IP rate limiting on the login endpoint.
- Icon resolution from the [dashboard-icons](https://github.com/homarr-labs/dashboard-icons)
  set by slug, or any direct image URL.
- Installable PWA via a generated web app manifest, plus an `/api/health`
  liveness endpoint.
- Multi-architecture (`linux/amd64`, `linux/arm64`) Docker image published to
  GHCR, with a Docker Compose setup.
- GitHub Actions pipelines: CI (lint, tests, build) and a tag-driven release
  that builds and publishes the image.
- Vitest test suite covering config read/write and merge semantics, schema
  validation, authentication, and login rate limiting.

[Unreleased]: https://github.com/boostctrl/homepage-app/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/boostctrl/homepage-app/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/boostctrl/homepage-app/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/boostctrl/homepage-app/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/boostctrl/homepage-app/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/boostctrl/homepage-app/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/boostctrl/homepage-app/releases/tag/v0.1.0
