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

- **Bundled local icons** for logos the dashboard-icons CDN doesn't carry —
  `rockauto` plus `car`, `tire`, `car-battery`, and `steering-wheel`. They're
  selectable like any other icon; add more by dropping an SVG in `public/icons/`
  and listing its slug in `LOCAL_ICONS`.
- **Theme-aware icons**: app/bookmark icons that ship light/dark variants now
  use the one that stays legible on the current surface (so a near-white logo no
  longer disappears on a light theme, and vice-versa), including custom themes
  via background luminance. Icons without variants are unchanged. (#10)
- **Admin default theme** (Admin → Settings → Appearance): set the site-wide
  default mode (light/dark/system), design, accent gradient, and optional custom
  background/text colors. It's the baseline an un-customized visitor sees, and
  every part is still overridable per-browser from the settings page.
  "Reset to site default" now also reverts a visitor's theme to this default.

### Changed

- The theme builder's accent preset swatches were removed — the gradient preview
  bar and the Start / End color pickers now cover everything. For a solid accent,
  set both ends to the same color.
- The server `accent` setting (a fixed named preset) is replaced by the richer
  `theme` block above. **Note:** existing `accent` values in `config.yaml` are
  dropped; set the accent under `settings.theme` instead.

## [0.5.2] - 2026-06-21

### Added

- **Designs** in the theme builder: choose a look-and-feel — **Glass** (default),
  **Aero**, **Flat**, **Soft**, **Minimal**, **Bold**, or **Cyber**. A design
  restyles every surface (rounding, blur, borders, shadows, background glow)
  while your colors keep applying on top, and it's applied before first paint
  (no flash). Per-visitor. Saved themes capture the chosen design too, so
  applying one restores its look-and-feel.

### Changed

- The theme builder's color presets (Midnight, Paper, Nord, …) are now a
  separate **Palettes** row, distinct from the new design picker.
- **Accent is now controlled only in the theme builder** (per-visitor), with a
  clearer UI: a live gradient preview bar, the curated preset swatches, and
  plainly labelled **Start** / **End** custom color pickers. The admin accent
  picker was removed; the configured `accent` remains the site-wide default.

## [0.5.1] - 2026-06-21

### Added

- **Base themes** in the theme builder: a gallery of preset starting points
  (Midnight, Paper, Nord, Forest, Ember, Slate, Rosé, Sand) to apply with one
  tap and then tweak.
- **Accent picker** in the theme builder: choose a preset or custom accent on
  its own — the background and text colors are left as-is, so you can recolor
  without committing to a full custom theme.
- **Greeting name** is now a per-visitor preference, set on the **/settings**
  page so each browser personalizes its own "Good evening, …" greeting.

### Changed

- The **/settings** page lays its panels out in two columns on large screens
  (and a single column on smaller ones) instead of a narrow fixed-width column.
- The admin **Settings** form is wider, matching the other admin sections.

### Removed

- The admin **Greeting name** field — the greeting name is now per-visitor (see
  Added). Existing config values are ignored.

## [0.5.0] - 2026-06-20

### Added

- **Theme builder** (Settings → Theme builder): craft a custom theme from color
  pickers (background, text/surfaces, accent gradient) with a live preview, save
  named themes, and switch between them. Per-visitor and applied before first
  paint (no flash). (#11)
- A dedicated **/settings** page for per-visitor preferences (theme, time zone,
  weather location, units), reached from a floating settings button pinned to
  the bottom-right corner — replacing the header gear popover. (#8, #9)

### Changed

- The header now shows the live date and clock inside the weather widget; the
  greeting stands on its own. (#7)
- The default `config.yaml` ships generic example apps (Media Server, Photos,
  …) instead of personally-named services. Existing deployments are unaffected
  (they use their own bind-mounted config). (#12)

## [0.4.0] - 2026-06-20

### Security

- Resolved the transitive `postcss` advisory (GHSA-qx2v-qp2m-jg93) by pinning
  `postcss` to a patched version (`^8.5.10`) via an npm `overrides`, deduping
  the vulnerable copy bundled under `next`. `npm audit` is now clean. (postcss
  is build-time tooling, so this never affected the running app.)

### Added

- Admin: searchable time-zone picker, and a city search (Open-Meteo geocoding)
  to set the default weather location by name instead of typing coordinates.

### Changed

- Per-visitor preferences are now grouped into a **Settings** panel opened from
  a gear button in the header. It holds everything a visitor can change without
  admin rights — theme, time zone, and (with weather on) location and units —
  plus the link to the admin portal. Replaces the clock-click popover and the
  "Manage" footer link.
- Admin bookmarks are now grouped by category, each reorderable within its
  group, matching how they appear on the dashboard.
- The admin Settings tab is organized into labeled sections (General,
  Appearance, Dashboard, Weather).
- Admin delete actions use a styled confirmation dialog instead of the
  browser's native prompt.

## [0.3.1] - 2026-06-20

### Fixed

- Plain-HTTP LAN deployments were broken by the `upgrade-insecure-requests` CSP
  directive added in 0.2.1. On a non-localhost HTTP origin (e.g.
  `http://<nas-ip>:3000`) it upgraded same-origin asset and API requests to
  HTTPS — which has no listener — so styles failed to load (the page looked
  unthemed) and the admin login/portal became unreachable. The directive has
  been removed; HTTPS deployments should rely on their reverse proxy/HSTS for
  upgrades. (Localhost was exempt from the upgrade, which is why it wasn't
  caught earlier.)

## [0.3.0] - 2026-06-20

### Added

- Light/dark mode: a per-visitor theme switch (System / Light / Dark) in the
  time/location popover. Defaults to following the OS, persists per browser, and
  is applied before first paint (no flash). Implemented via a themeable color
  token so the whole UI flips cleanly.
- Icon browser: a "Browse icons" button in the app and bookmark forms opens a
  searchable grid of the dashboard-icons set, so you can pick an icon by sight
  instead of having to know its slug.
- Change the admin password from the UI (Settings → Change password). The new
  password is stored hashed (PBKDF2-SHA-256, per-password salt) in the config;
  `ADMIN_PASSWORD` becomes the bootstrap/fallback credential. Changing it
  requires the current password even with a valid session.
- Custom search engine for the search bar (Settings → Search bar engine):
  choose DuckDuckGo, Google, Bing, Brave, or a custom `%s` URL template.
  Pressing Enter opens the top match, or searches the web when nothing matches;
  the no-results state offers an explicit "Search … for …" link.
- Auto-detected, per-visitor location and time zone: the header detects each
  visitor's time zone automatically and (when the weather widget is on) their
  approximate location by IP, with a discreet editor — click the time/location
  line — to correct the time zone, switch units, or use precise device
  location. Preferences are stored per-browser and never change the shared site
  config, so any visitor can fix their own view.

### Changed

- The admin applications list now shows each app's subtitle alongside its URL.

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

[Unreleased]: https://github.com/boostctrl/homepage-app/compare/v0.5.2...HEAD
[0.5.2]: https://github.com/boostctrl/homepage-app/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/boostctrl/homepage-app/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/boostctrl/homepage-app/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/boostctrl/homepage-app/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/boostctrl/homepage-app/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/boostctrl/homepage-app/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/boostctrl/homepage-app/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/boostctrl/homepage-app/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/boostctrl/homepage-app/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/boostctrl/homepage-app/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/boostctrl/homepage-app/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/boostctrl/homepage-app/releases/tag/v0.1.0
