# ctrlcenter

A self-hosted **start page and service dashboard** — a fast, searchable home for
every app and bookmark you run, with live status and alerts, weather, an agenda,
and a theme system that's genuinely fun to make your own. One small YAML file, a
built-in admin UI, and a single container.

Built with Next.js 16, React 19, and Tailwind v4.

---

## Features

- **Your apps & bookmarks — front and center.** A clean, fast grid of the services
  you run: each a card with a crisp icon, name, and subtitle, one click from
  launch — with category-grouped bookmarks in the same view. The dashboard is
  built to get you where you're going in a keystroke:
  - **Instant search** — press `/` to focus, filter apps *and* bookmarks as you
    type, `Enter` opens the top match, `Esc` clears.
  - **Bang shortcuts** — start a query with `!` to jump straight out: built-ins
    (`!gh`, `!yt`, `!w`, `!npm`, `!maps`, `!so`, …), your own custom bangs, and an
    auto-bang for every app (so `!plex` opens Plex). An unrecognized bang just
    falls back to a web search.
  - **Favorites** — pin your most-used apps to a row at the top. Per visitor,
    stored in their browser, no account needed.
  - **Rich icons** — a [dashboard-icons](https://github.com/homarr-labs/dashboard-icons)
    slug, any direct image URL, or your own upload (PNG/JPEG/WebP/GIF/SVG/ICO);
    light/dark variants auto-pick the legible one for the active surface.
  - **Drag-to-reorder** apps and bookmark categories from the admin UI
    (keyboard- and touch-friendly, not just mouse drag).

- **Uptime, status & alerts.** Optional reachability checks put an online/offline
  dot on each app and power a dedicated **/status** page with per-service **uptime
  %** and a **90-day daily timeline** (Statuspage / UptimeRobot style), recorded by
  a background poller independent of page views. Each service picks a **check
  method** — HTTP (choose which status codes count as up, so a `404` reads as
  **down**), **TCP port**, **keyword** in the response body, **DNS** resolution, or
  **ICMP ping** — so non-web services can be monitored too. **Alerts** fire when a
  service goes down or recovers: to a **webhook** (generic JSON, Discord, Slack, or
  ntfy) and/or by **email** over SMTP (works with SMTP2GO, Gmail, Fastmail, any
  relay), with flap-dampening confirmations so a single blip stays quiet.

- **A real theme system.** Mix and match three independent axes and save the
  result:
  - **Designs** — the card surface: `glass`, `aero`, `flat`, `soft`, `minimal`,
    `bold`, `cyber`, `clay`, `frost`, `outline`, `paper`, `gradient`.
  - **Scenes** — an animated backdrop: `aurora`, `abyss`, `nebula`, `grid`,
    `starfield`, `waves`, `rays`, `traces`, `dots`, `glow`, `vortex`, `mesh`
    (all motion respects `prefers-reduced-motion`).
  - **Colors & font** — a palette plus an accent gradient (or hand-pick your
    own), and a UI font: `jakarta`, `inter`, `poppins`, `nunito`, `lora`,
    `jetbrains`.

  Every look has a **cohesive light and dark variant**, and one-tap **Themes**
  (Default, Mariana, Outrun, Observatory, Tide, …) bundle a palette, design, and
  scene together. The admin sets a site-wide default; each visitor can override
  any of it in their own browser.

- **Weather.** A header widget with the current conditions, plus a full
  **/weather** page: a hero with feels-like, an hourly forecast, a 7-day outlook
  with temperature range bars, a sunrise/sunset arc, and tiles for wind
  (speed + direction), chance of precipitation, humidity, UV, pressure, and
  cloud cover. Powered by [Open-Meteo](https://open-meteo.com) — no API key.

- **Agenda.** An **Upcoming** card pulls the next few events from any published
  iCal (`.ics`) URL — a Google Calendar secret address, Fastmail, Nextcloud, and
  the like. Recurring events (daily/weekly/monthly, with exceptions) are expanded,
  and times render in each visitor's own time zone.

- **Per-visitor personalization, no accounts.** Each visitor sets a greeting name,
  timezone, weather location/units, and their whole theme from **/settings** — all
  stored in their own browser, never on the server. And the admin can **show or
  hide any individual home-page component** (greeting, clock, search, apps,
  bookmarks, favorites, weather, status, agenda, settings button) to compose the
  page they want.

- **Admin portal.** A password-gated UI to manage apps, bookmarks, and settings
  without touching YAML: an icon picker with live preview and uploads, favicon
  config, search engine and custom bangs, alerts, the agenda feed, and one-click
  **Export/Import** of your whole config.

- **Self-hosted & simple.** A single YAML config, a prebuilt multi-arch Docker
  image, an installable PWA manifest, and `/api/health` for orchestrators.

## AI disclaimer

ctrlcenter is a **vibecoded project** — it is built primarily with AI coding
tools. I have experience with scripting and some light coding, but I am not a
developer. Security is taken seriously (see [SECURITY.md](SECURITY.md) for the
policy and deployment guidance), and changes are reviewed and tested before
release — but you should weigh how the project is built when deciding whether
to deploy it. **Running this app is at your own risk**, and reviewing the code
yourself before deploying is recommended.

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

Your data lives in `./config/config.yaml`, bind-mounted into the container and
created automatically on first run (see [`config/config.example.yaml`](config/config.example.yaml)
for a sample). The container fixes ownership of that directory on startup and
runs as a non-root user, so it works regardless of who owns the host folder — no
manual `chown`.

## Configuration

Edit through **/admin** (recommended) or by hand — changes are picked up on the
next page load, no rebuild. The file has three sections:

```yaml
settings:
  title: ctrlcenter         # browser tab title
  timezone: America/Chicago # IANA timezone, used for the date + greeting
  theme:                    # site-wide default (visitors can override in /settings)
    mode: system            # system | light | dark
    design: glass           # glass|aero|flat|soft|minimal|bold|cyber|clay|frost|outline|paper|gradient
    scene: aurora           # aurora|abyss|nebula|grid|starfield|waves|rays|traces|dots|glow|vortex|mesh
    font: jakarta           # jakarta | inter | poppins | nunito | lora | jetbrains
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
    # bangs:                # optional custom !shortcuts (built-ins always work)
    #   - key: docs
    #     url: "https://docs.example.com/search?q=%s"
  weather:
    enabled: true
    latitude: 38.9072
    longitude: -77.0369
    units: imperial         # imperial | metric
  alerts:                   # notify when a service goes down / recovers
    enabled: false
    type: discord           # generic | discord | slack | ntfy   (webhook channel)
    webhookUrl: ""
    confirmations: 2        # consecutive failed checks before "down" (flap dampening)
    email:                  # optional SMTP channel, sent alongside the webhook
      enabled: false
      host: mail.smtp2go.com
      port: 587             # 587/STARTTLS, or 465 with secure: true
      from: ctrlcenter@example.com
      to: you@example.com
      # user: ""            # SMTP username
      # pass: ""            # or set the CTRLCENTER_SMTP_PASS env var instead
  calendar:                 # the Upcoming agenda card
    enabled: false
    url: ""                 # a published iCal (.ics) URL
    count: 5                # how many upcoming events to show (1–20)
  components:               # show/hide home-page parts — all default true
    greeting: true
    clock: true
    search: true
    apps: true
    bookmarks: true
    favorites: true
    settingsButton: true

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
| `CTRLCENTER_SMTP_PASS` | no | Overrides the email-alert SMTP password, so the secret can stay out of `config.yaml`. |
| `TRUSTED_PROXY_HOPS` | no | Number of trusted reverse proxies in front of the app, used to find the real client IP in `X-Forwarded-For` for login throttling. Default `1` (the app sits behind one reverse proxy). **Set `0` if the app is exposed directly** — otherwise a client can spoof `X-Forwarded-For` to forge a fresh source IP per request and slip past the per-IP login throttle. A global attempt cap still applies as a backstop, but the per-IP limit is your first line of defense. |

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
login throttling, and the pure helpers behind theming, weather, status, search
bangs, alerting, and the iCal/recurrence parser.

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
  ([`lib/status-poller.ts`](lib/status-poller.ts) → [`lib/status-history.ts`](lib/status-history.ts)),
  which also drives down/recovery [`alerts`](lib/alerts.ts).
- [`lib/calendar.ts`](lib/calendar.ts) fetches and parses the iCal agenda feed
  (with recurrence expansion); [`lib/search.ts`](lib/search.ts) resolves search
  bangs.
- `app/api/` holds the admin CRUD/reorder routes plus `status`, `status/history`,
  and `health`.

## License

[MIT](LICENSE) © boostctrl
