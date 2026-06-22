# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release groups changes under **Added**, **Changed**, **Deprecated**,
**Removed**, **Fixed**, and **Security** (only the relevant sections appear).
The notes published with each GitHub release mirror that version's section
here.

## [Unreleased]

## [0.7.0] - 2026-06-21

### Added

- **Theme scenes**: a new backdrop-and-ornament layer chosen in the theme
  builder, independent of the palette and design. _Aurora_ (the floating accent
  glow, default) and _Abyss_ — a deep-sea scene with a bioluminescent backdrop,
  drifting marine snow, and a depth-gauge ornament. All motion respects
  `prefers-reduced-motion`.
- **Theme packs**: one-tap curated looks that set a palette, design, and scene
  together (still tweakable afterward), starting with _Mariana_.
- **Uptime status page** at `/status`: every app with its up/down state, HTTP
  code, response time, and a live "last checked" time, plus an overall health
  summary and a manual refresh. A health pill by the dashboard's "Applications"
  heading links to it. Gated by the existing status-checks setting; 30-day
  uptime history is tracked in #26.

### Changed

- **Every look now has a cohesive light _and_ dark variant**, and the
  light/dark/system toggle is always live: switching modes keeps the active look
  (palette, pack, scene) and swaps its colors instead of dropping it. Palettes
  and the Mariana pack ship hand-tuned light and dark; scenes adapt (Abyss
  becomes "sunlit shallows" in light); designs use mode-aware shadows. Admin
  custom default colors are now a light/dark pair.
- The app reachability **dot** is now backed by the full `/status` page; the
  per-card dots remain.

## [0.6.0] - 2026-06-21

### Added

- **Admin-configurable favicon** (Admin → Settings → General): set the
  browser-tab icon to a dashboard-icons slug, a bundled local icon, or an image
  URL — using the same icon picker as apps/bookmarks. (#15)
- **Sortable bookmark categories**: reorder categories from the admin Bookmarks
  tab (move buttons on each category); the dashboard honors the saved order. (#20)
- **Weather forecast page**: the weather widget now links to a `/weather` page
  with current conditions, a next-24-hours hourly strip, and a 7-day outlook for
  the visitor's location/units. (#21)

### Changed

- **Designs now have distinct backdrops** that reinforce each look: Glass/Aero
  keep the accent glow (Aero adds a top light wash), Soft a gentle ambient
  radial, Flat a faint top wash, Bold a monochrome grid, Cyber a neon-accent
  grid, Minimal stays clean — all driven by tokens so any palette still works.
  (#19)
- The light/dark/system **mode** selector moved into the theme builder, next to
  the design and color controls. (#17)
- The **admin portal** link moved into the settings panel footer instead of a
  separate card below it. (#16)

### Fixed

- **"Use my location"** now works: the `Permissions-Policy` header was disabling
  geolocation for all origins (`geolocation=()`); it's now allowed for the app's
  own origin. The button also reports a clear reason when it can't get a fix
  (insecure/non-HTTPS origin, denied permission, or timeout) instead of failing
  silently. (#18)

### Security

- **Login rate limit** no longer trusts the client-supplied (leftmost)
  `X-Forwarded-For`; it derives the client from the trusted-proxy hop count
  (`TRUSTED_PROXY_HOPS`, default 1) and adds a global attempt cap so a spoofed-IP
  flood can't bypass throttling or exhaust CPU on PBKDF2. (#4)
- **Nonce-based CSP**: `script-src` now uses a per-request nonce +
  `'strict-dynamic'` instead of `'unsafe-inline'`, tightening XSS protection.
  (#5)
- **Open redirect** after login fixed: the `?next=` target is only followed when
  it's a same-site path. (#23)
- **Revocable sessions**: changing the admin password now invalidates all
  existing session tokens (even with a dedicated `SESSION_SECRET`); the admin who
  changes it is reissued a fresh session. (#24)

## [0.5.3] - 2026-06-21

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

[Unreleased]: https://github.com/boostctrl/homepage-app/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/boostctrl/homepage-app/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/boostctrl/homepage-app/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/boostctrl/homepage-app/compare/v0.5.2...v0.5.3
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
