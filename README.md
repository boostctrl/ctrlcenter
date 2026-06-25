# ctrlcenter

A self-hosted **start page and service dashboard** — your apps and bookmarks,
live weather, and at-a-glance uptime for everything you run, wrapped in a theme
system that's genuinely fun to make your own. One small YAML file, a built-in
admin UI, and a single container.

Built with Next.js 16, React 19, and Tailwind v4.

---

## Features

- **Apps & bookmarks.** A clean grid of your services and category-grouped
  bookmarks. Instant search across everything (press `/` to focus, `Esc` to
  clear), and drag-to-reorder apps and bookmark categories from the admin UI.

- **A real theme system.** Mix and match three independent axes and save the
  result:
  - **Designs** — the card surface: `glass`, `aero`, `flat`, `soft`, `minimal`,
    `bold`, `cyber`.
  - **Scenes** — an animated backdrop: `aurora`, `abyss`, `nebula`, `grid`,
    `starfield`, `waves` (all motion respects `prefers-reduced-motion`).
  - **Colors** — a palette plus an accent gradient, or hand-pick your own.

  Every look has a **cohesive light and dark variant**, and one-tap **Themes**
  (Default, Mariana, Outrun, Observatory, Tide, …) bundle a palette, design, and
  scene together. The admin sets a site-wide default; each visitor can override
  any of it in their own browser.

- **Weather.** A header widget with the current conditions, plus a full
  **/weather** page: a hero with feels-like, an hourly forecast, a 7-day outlook
  with temperature range bars, a sunrise/sunset arc, and tiles for wind
  (speed + direction), chance of precipitation, humidity, UV, pressure, and
  cloud cover. Powered by [Open-Meteo](https://open-meteo.com) — no API key.

- **Uptime & status.** Optional reachability checks show an online/offline dot on
  each app, and a dedicated **/status** page with per-service **uptime %** and a
  **90-day daily timeline** (Statuspage / UptimeRobot style). A background poller
  records history independent of page views. Each service picks a **check method**
  — HTTP (define which status codes count as up, so a `404` reads as **down**),
  **TCP port**, **keyword** in the response body, **DNS** resolution, or **ICMP
  ping** — so non-web services can be monitored too.

- **Per-visitor personalization, no accounts.** Each visitor can set a greeting
  name, timezone, weather location/units, and their whole theme from **/settings**
  — all stored in their own browser, never on the server.

- **Admin portal.** A password-gated UI to manage apps, bookmarks, and settings
  without touching YAML: an icon picker with live preview, favicon config, the
  search engine, and one-click **Export/Import** of your whole config.

- **Self-hosted & simple.** A single YAML config, a prebuilt multi-arch Docker
  image, an installable PWA manifest, and `/api/health` for orchestrators.

## Quick start (Docker Compose)

1. Set an admin password:
   ```bash
   cp .env.example .env
   # edit .env: set ADMIN_PASSWORD (and, recommended, SESSION_SECRET)
   ```
2. Pull and run the published image:
   ```bash
   docker compose pull
   docker compose up -d
   ```
   The bundled [docker-compose.yml](docker-compose.yml) uses
   `ghcr.io/boostctrl/ctrlcenter:latest`. To build from source instead, comment
   out `image:`, uncomment `build: .`, and run `docker compose up -d --build`.
3. Open **http://localhost:3000** for the dashboard and **/admin** to manage it
   (sign in with `ADMIN_PASSWORD`).

Your data lives in `./config/config.yaml`, bind-mounted into the container. The
container fixes ownership of that directory on startup and runs as a non-root
user, so it works regardless of who owns the host folder — no manual `chown`.

## Configuration

Edit through **/admin** (recommended) or by hand — changes are picked up on the
next page load, no rebuild. The file has three sections:

```yaml
settings:
  title: ctrlcenter         # browser tab title
  timezone: America/Chicago # IANA timezone, used for the date + greeting
  theme:                    # site-wide default (visitors can override in /settings)
    mode: system            # system | light | dark
    design: glass           # glass | aero | flat | soft | minimal | bold | cyber
    scene: aurora           # aurora | abyss | nebula | grid | starfield | waves
    accentFrom: '#a78bfa'   # accent gradient start (#rrggbb)
    accentTo: '#22d3ee'     # accent gradient end (same as start = solid)
    # Optional fixed default colors (override light/dark mode). Set in pairs:
    # background: '#06070d'       # dark surface / ink
    # foreground: '#f4f4f6'
    # backgroundLight: '#eceef3'  # light surface / ink
    # foregroundLight: '#181b24'
  statusChecks: false       # ping app URLs, show online/offline dots + /status
  statusInterval: 5         # minutes between background uptime checks (1–60)
  search:
    engine: duckduckgo      # duckduckgo | google | bing | brave | custom
    customUrl: ""           # used when engine: custom; must contain %s
  weather:
    enabled: true
    latitude: 38.9072
    longitude: -77.0369
    units: imperial         # imperial | metric

apps:
  - id: <uuid>
    name: Cloud Drive
    subtitle: Nextcloud
    url: "https://cloud.example.com"
    icon: nextcloud          # slug, full image URL, or uploaded icon
    checkType: http          # http | tcp | keyword | dns | icmp
    expectStatus: ""         # http: codes/ranges that count as up, e.g. "200-299, 401"
                             # (blank = any reachable host is up)
    # port: 5432             # tcp: port to connect to (else the URL's port, or 443/80)
    # keyword: "Welcome"     # keyword: text that must appear in the response body

bookmarks:
  - id: <uuid>
    category: Shopping       # bookmarks are grouped by category
    name: Amazon
    url: "https://amazon.com"
    icon: amazon
```

### Icons

Set `icon` to a slug from the
[dashboard-icons](https://github.com/homarr-labs/dashboard-icons) set
(e.g. `plex`, `nextcloud`, `youtube`) and it resolves automatically — icons with
light/dark variants pick the legible one for the active surface. Not in the set?
Paste a direct image URL (anything starting with `http(s)://` is used as-is). The
admin shows a live preview as you type.

Need a logo the CDN doesn't carry? In the admin icon picker, click **Upload
image** to add your own (PNG, JPEG, WebP, GIF, SVG, or ICO). Uploaded icons are
stored beside `config.yaml` (in an `uploads/` dir, so they persist on the same
volume) and served by the app; they show up under **Your icons** in the picker
for reuse. You can also paste a direct image URL or a `data:` URI.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `ADMIN_PASSWORD` | yes | Bootstrap password for `/admin`. After you set one in **Settings → Reset password**, login uses that — but keep this set (or set `SESSION_SECRET`), as it also signs sessions. **Special characters:** quote the value in `.env` and double any literal `$` as `$$` (docker compose interpolates `$`), or a complex password can be mangled before the app sees it. |
| `SESSION_SECRET` | no | Secret used to sign session cookies. If unset, derived from `ADMIN_PASSWORD`. Recommended so sessions don't depend on the password. Generate with `openssl rand -base64 32`. |
| `CONFIG_PATH` | no | Path to the config file (default `./config/config.yaml`; the container sets `/config/config.yaml`). The uptime history (`status-history.json`) and uploaded custom icons (`uploads/`) are written beside it. |
| `TRUSTED_PROXY_HOPS` | no | Number of trusted reverse proxies in front of the app, used to find the real client IP in `X-Forwarded-For` for login throttling. Default `1`. Set `0` if exposed directly. |

## Development

Requires **Node.js 22+**.

```bash
npm install
npm run dev          # http://localhost:3000
```

The app reads/writes `config/config.yaml` relative to the project root in dev
(override with `CONFIG_PATH`). Put `ADMIN_PASSWORD` in `.env.local` to use the
admin UI locally.

```bash
npm run lint
npm test             # Vitest unit tests; npm run test:watch to watch
npm run build
```

Tests cover the config read/write + merge logic, schema validation, auth and
login throttling, and the pure helpers behind theming, weather, and status.

### How it fits together

- [`lib/config.ts`](lib/config.ts) reads/writes `config.yaml`, validated by
  [`lib/schema.ts`](lib/schema.ts) (zod).
- [`lib/auth.ts`](lib/auth.ts) + [`proxy.ts`](proxy.ts) gate `/admin` with a
  signed-cookie session, enforced by the Next.js middleware (which also sets a
  per-request CSP nonce).
- `components/scenes/` are the animated backdrops; the theme builder lives in
  [`components/ThemeBuilder.tsx`](components/ThemeBuilder.tsx) and persists
  per-visitor prefs via [`components/PrefsProvider.tsx`](components/PrefsProvider.tsx).
- [`instrumentation.ts`](instrumentation.ts) starts the background uptime poller
  ([`lib/status-poller.ts`](lib/status-poller.ts) → [`lib/status-history.ts`](lib/status-history.ts)).
- `app/api/` holds the admin CRUD/reorder routes plus `status`, `status/history`,
  and `health`.

## Releasing

Day-to-day work lands on `develop`; `main` tracks released code. Every push/PR
runs CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint, tests,
build). To cut a release:

1. On `develop`, move `CHANGELOG.md`'s `[Unreleased]` section to a new
   `[X.Y.Z]` heading with today's date (Keep a Changelog format), add a fresh
   empty `[Unreleased]`, update the compare links, and bump `version` in
   `package.json`.
2. Merge `develop` into `main`, then tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.

Pushing a `v*` tag triggers [`.github/workflows/release.yml`](.github/workflows/release.yml):
it re-runs tests, builds and publishes a multi-arch (`amd64`/`arm64`) image to
`ghcr.io/boostctrl/ctrlcenter` (tagged `X.Y.Z`, `X.Y`, `latest`), and creates the
GitHub release with notes pulled from the matching `CHANGELOG.md` section.
Hyphenated tags (e.g. `v1.0.0-rc1`) publish as pre-releases.

## License

[MIT](LICENSE) © boostctrl
