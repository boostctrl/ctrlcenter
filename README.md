# ctrlcenter

A self-hosted start page and service dashboard: a searchable home for the apps
and bookmarks you run, with optional status checks and alerts, weather, an
agenda, notes, countdowns, an RSS feed, and a theming system. Configured with a
single YAML file (or the built-in admin UI) and shipped as one container.

Built with Next.js 16, React 19, and Tailwind v4.

---

## Features

- **Apps & bookmarks.** A grid of the services you run — each a card with an
  icon, name, and subtitle, one click from launch — with category-grouped
  bookmarks in the same view. To find things quickly:
  - **Search** — press `/` to focus, filter apps *and* bookmarks as you
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

- **Theming.** Combine three independent axes and save the result:
  - **Designs** (18) — the card surface: `glass`, `aero`, `flat`, `soft`,
    `minimal`, `bold`, `cyber`, `clay`, `frost`, `outline`, `paper`, `gradient`,
    `aura`, `emboss`, `carve`, `stripe`, `sketch`, `console`.
  - **Scenes** (18) — an animated backdrop: `aurora`, `abyss`, `nebula`, `grid`,
    `starfield`, `waves`, `rays`, `traces`, `dots`, `horizon`, `orbit`, `peaks`,
    `rain`, `fireflies`, `blueprint`, `prisms`, `petals`, `comets` (motion
    respects `prefers-reduced-motion`).
  - **Colors & font** — a palette plus an accent gradient (or your own colors),
    and one of 12 UI fonts (`jakarta`, `inter`, `poppins`, `nunito`, `lora`,
    `jetbrains`, `outfit`, `grotesk`, `manrope`, `rubik`, `playfair`,
    `quicksand`).

  Each look carries its own light and dark variant, and one-tap **Themes**
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
  the like (private CalDAV/WebDAV with credentials too). Recurring events
  (daily/weekly/monthly, with exceptions) are expanded, and times render in each
  visitor's own time zone.

- **More home widgets.** A **Notes** card (a safe markdown subset), a
  **Countdown** card ("in N days" to labeled dates), and an **RSS/Atom feed**
  card — each optional and placed from the layout editor. Plus a site-wide
  **announcement banner** for notices or maintenance windows, with a tone and an
  optional visitor dismiss.

- **Per-visitor personalization, no accounts.** Each visitor sets a greeting name,
  timezone, weather location/units, and their whole theme from **/settings** — all
  stored in their own browser, never on the server.

- **A drag-and-drop home page.** Every widget lives on a 24-column grid. Signed-in
  admins get an **Edit layout** mode on the home page: reorder by dragging, resize
  a card's width and height by dragging its edges, add per-side spacing, choose
  how many cards per row the apps/bookmarks/favorites grids show, scale the whole
  UI, and show or hide anything in place. The editor previews the same packed
  layout the live page renders, and steppers back every drag for keyboard and
  touch.

- **Admin portal.** A password-gated UI to manage apps, bookmarks, and settings
  without touching YAML: an icon picker with uploads, favicon, search engine and
  custom bangs, status checks and alerts, weather, the agenda, notes, countdowns,
  the RSS feed, the announcement banner, and one-click **Export/Import** of the
  whole config (uploaded icons included).

- **Self-hosted & simple.** A single YAML config, a prebuilt multi-arch Docker
  image, an installable PWA manifest, and `/api/health` for orchestrators.

## AI disclaimer

ctrlcenter is built primarily with AI coding tools. I have some scripting and
light coding experience, but I'm not a professional developer. I try to follow
reasonable security practices (see [SECURITY.md](SECURITY.md) for the policy and
deployment guidance) and changes are tested before release, but the project is
built this way — please weigh that when deciding whether to deploy it. **Run it
at your own risk**, and review the code yourself first.

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
    design: glass           # glass aero flat soft minimal bold cyber clay frost outline paper gradient aura emboss carve stripe sketch console
    scene: aurora           # aurora abyss nebula grid starfield waves rays traces dots horizon orbit peaks rain fireflies blueprint prisms petals comets
    font: jakarta           # jakarta inter poppins nunito lora jetbrains outfit grotesk manrope rubik playfair quicksand
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
  components:
    clock: true             # the date/time row inside the header card
    settingsButton: true    # the floating corner navigation menu
    # greeting/search/apps/bookmarks/favorites are legacy visibility flags —
    # still honored for old configs, but layout `hidden` (below) is the source
    # of truth once set.
  layout:                   # the home-page widget grid — best edited visually:
    sections:               # sign in and pick "Edit layout" from the corner menu
      - { id: greeting, span: 8 }         # order = position; widgets flow row
      - { id: headerCard, span: 4 }       #   by row across 12 columns
      - { id: clock, span: 4, hidden: true }    # split clock/weather/status
      - { id: weather, span: 4, hidden: true }  #   widgets — show them as an
      - { id: status, span: 4, hidden: true }   #   alternative to headerCard
      - { id: search, span: 12 }
      - { id: calendar, span: 12 }
      - { id: favorites, span: 12 }
      - { id: apps, span: 12 }
      - { id: bookmarks, span: 12 }
    # pre-1.3 configs used `width: full|twoThirds|half|third` — still accepted,
    # auto-migrated to spans (12/8/6/4) on the next save.

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
| `CTRLCENTER_CALDAV_PASS` | no | Overrides the private-calendar (CalDAV/WebDAV) password, so that secret can stay out of `config.yaml` too. |
| `CTRLCENTER_HOST_PROC` | no | Where the System stats widget looks for a host-mode `/proc` mount (default `/host/proc`). In a container the widget normally reports the *container's* cgroup-scoped CPU/memory; to show the host machine instead, bind-mount the host's `/proc` read-only — `-v /proc:/host/proc:ro` (compose: `- /proc:/host/proc:ro`) — and the widget switches to host mode automatically, no privileges needed. Disks are separate: a path must be mounted into the container to be measured. |
| `LOG_LEVEL` | no | Server log verbosity: `debug`, `info` (default), `warn`, or `error`. Diagnostics — a timed-out weather/feed/calendar fetch, a rejected alert — are logged to the container's stdout/stderr. |
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
npm run typecheck    # tsc --noEmit — next build compiles without checking types
npm test             # Vitest unit tests; npm run test:watch to watch
npm run build
```

Tests cover the config read/write + merge logic, schema validation, auth and
login throttling, and the pure helpers behind theming, weather, status, search
bangs, alerting, and the iCal/recurrence parser.

Work lands on `develop`; `main` only advances by fast-forward when a release
is cut with `scripts/release.sh X.Y.Z`, whose `v*` tag push builds the image
and publishes the GitHub release. The full workflow conventions — branching,
changelog, issue hygiene — live in [CLAUDE.md](CLAUDE.md).

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
