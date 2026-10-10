# ctrlcenter

A self-hosted start page and service dashboard: a searchable home for the apps
and bookmarks you run, with optional status checks and alerts, weather, an
agenda, notes, countdowns, world clocks, system stats, an RSS feed, and a
theming system. Configured with a single YAML file (or the built-in admin UI)
and shipped as one container.

Built with Next.js 16, React 19, and Tailwind v4.

---

## Features

- **Apps & bookmarks.** A grid of the services you run — each a card with an
  icon, name, and subtitle, one click from launch — with group-sorted
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
  - **Groups and tags** — sort apps and bookmarks into groups, tag apps,
    and give each group its own card: an Applications widget shows one group
    or tag, a Bookmarks widget one group or all of them.
  - **Drag-to-reorder** apps, bookmarks and groups from the admin UI
    (keyboard- and touch-friendly, not just mouse drag).
  - **Private items** — mark an app or bookmark **Only show when logged in**
    and it disappears for signed-out visitors (from the dashboard, search, and
    the status page alike) while staying monitored and alerted on.

- **Uptime, status & alerts.** Optional reachability checks put an online/offline
  dot on each app and power a dedicated **/status** page with per-service **uptime
  %** and a **90-day daily timeline** (Statuspage / UptimeRobot style), recorded by
  a background poller independent of page views. Every service card clicks
  through to its **detail page**: a finer-grained uptime graph, **response-time
  analytics** (average and max latency per range), and an **outage log** with
  exact start and end times — where a signed-in admin can attach **incident
  notes** ("planned maintenance", "ISP fault") that visitors see beside the
  entry. **Status announcements** post maintenance windows and notices on the
  status page itself, with optional scheduling, and can hold an app's alerts as
  a **maintenance window**. The status page has an **Atom feed** of outages
  and announcements (`/status/feed.xml`), and each app a shields-style **SVG
  badge** (`/api/status/badge/<id>.svg`). Each service picks a **check
  method** — HTTP (choose which status codes count as up, so a `404` reads as
  **down**), **TCP port**, **keyword** in the response body, **DNS** resolution, or
  **ICMP ping** — so non-web services can be monitored too. **Alerts** fire when a
  service goes down or recovers, to as many channels as you like: a **webhook**
  (generic JSON, Discord, Slack, or ntfy), **email** over SMTP (works with
  SMTP2GO, Gmail, Fastmail, any relay), **Telegram**, **Gotify**, **Pushover**,
  or an **Apprise** API server. Each channel picks its events and apps, and
  flap-dampening confirmations keep a single blip quiet.

- **Theming.** A builder with a live preview, built on independent axes you
  combine and save:
  - **Designs** (18) — the card surface: `glass`, `aero`, `flat`, `soft`,
    `minimal`, `bold`, `cyber`, `clay`, `frost`, `outline`, `paper`, `gradient`,
    `aura`, `emboss`, `carve`, `stripe`, `sketch`, `console` — each with a
    **Tune** tab of sliders over it (corner radius, border, blur, shadow, fill,
    glow).
  - **Scenes** (18, or none) — an animated backdrop: `aurora`, `abyss`,
    `nebula`, `grid`, `starfield`, `waves`, `rays`, `traces`, `dots`,
    `horizon`, `orbit`, `peaks`, `rain`, `fireflies`, `blueprint`, `prisms`,
    `petals`, `comets`, with intensity and motion controls (and a Reduce-motion
    switch that stills them all). A **wallpaper** can sit behind the scene,
    blurred and dimmed.
  - **Colors & type** — a palette plus an accent gradient, or your own colors,
    including the status colors (up, down, warning, info); or pick one accent
    and let the builder derive a whole palette with contrast guaranteed. A body
    font and a heading font from 12 faces (`jakarta`, `inter`, `poppins`,
    `nunito`, `lora`, `jetbrains`, `outfit`, `grotesk`, `manrope`, `rubik`,
    `playfair`, `quicksand`), and a density step.

  Each look carries its own light and dark variant. One-tap **Themes** bundle
  it all; the admin curates that gallery (edit the built-ins, add their own,
  hide and reorder), sets a site-wide default, can schedule a day and a night
  theme by sunrise and sunset or fixed times, pin a theme on a board, and
  decides how much visitors may change: everything, the gallery only, or
  nothing. Visitors save their own themes, share one as a short code or link,
  and every built-in look clears WCAG AA contrast in both modes.

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
  **Countdown** card ("in N days" to labeled dates), **World clocks** (live
  times and dates for the zones you follow), **System stats** (CPU, memory, and
  disk fill — container-aware, with an opt-in host mode), and an **RSS/Atom
  feed** card, and **API widgets** that show a stat, gauge, rows or a list
  picked out of any JSON endpoint — each optional and placed from the layout
  editor. Plus a
  site-wide **announcement banner** for notices or maintenance windows, with a
  tone and an optional visitor dismiss.

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

- **Private Monitor page.** Connect **qBittorrent, Sonarr, Radarr, AdGuard
  Home, Tautulli, Seerr, Portainer, TrueNAS and UniFi** — as many of each as you
  run, say a 4K Sonarr beside an HD one — (Admin → Settings → Integrations,
  each with a test-connection button) and a
  signed-in-only **/admin/monitor** page shows their live state: transfer
  speeds and the active torrent list for qBittorrent, and — for Sonarr and
  Radarr — what's coming up (upcoming episodes and movie releases), what was
  recently grabbed or imported, and any health warnings. Read-only by default;
  for **qBittorrent, Seerr, and Portainer** you can opt in per integration
  ("Allow actions from the dashboard") to act from the page — pause/resume/delete
  torrents, approve/deny requests, and start/stop/restart containers with a
  read-only log tail. Actions stay **off until you turn them on**, are admin-only,
  ask before anything destructive, and are logged on the server. Strictly
  admin-only throughout — the page, its API, and the stored credentials are all
  behind the admin session, any credential can be a `${ENV_VAR}` reference
  instead of a value in the config file, and nothing integration-related ever
  renders on the public
  dashboard.

- **Self-hosted & simple.** A single YAML config, a prebuilt multi-arch Docker
  image, an installable PWA manifest, `/api/health` for orchestrators, and an
  in-app **/help** page that documents every feature where visitors will look
  for it. Every page outside the dashboard opens with the same slim navigation
  strip, so weather, status, calendar, help, and settings stay one click apart.

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
   # edit .env: set ADMIN_PASSWORD
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
   (sign in with `ADMIN_PASSWORD`). A new install starts with a short guided
   setup — location and time zone, your first apps, status checks and a
   theme. Skip any step; it's all in Settings later.

Your data lives in `./config/config.yaml`, bind-mounted into the container and
created automatically on first run (see [`config/config.example.yaml`](config/config.example.yaml)
for a sample). The container fixes ownership of that directory on startup and
runs as a non-root user, so it works regardless of who owns the host folder — no
manual `chown`.

## Upgrading to 3.0

3.0 changes how `config.yaml` is organized. There's nothing to do by hand:
on its first start, 3.0 reads your 2.x file and saves it in the new shape,
keeping your comments — except those on the settings that move (below),
which stay in the backup.

- **A backup first.** The 2.x file is copied beside the config as
  `config.v2.bak.yaml`. It's written once and never overwritten, so it stays
  your way back however many times you restart or import.
- **A note in the log** says what was converted, and **/admin** shows a
  one-time banner with the same summary until you dismiss it.

What moved where:

| 2.x | 3.0 |
| --- | --- |
| `settings.layout.sections` (the home page arrangement) | the first board in `boards:` — the home page. Scale and spacing stay in `settings.layout`. |
| Each widget's content in `settings.notes`, `.countdown`, `.worldClocks`, `.systemStats`, `.calendar`, `.feeds` | one entry per widget in `widgets:`, each with an `id`. You can now have more than one of any kind. |
| A bookmark's `category` | `groups:`, which bookmarks (and now apps) name with `group:` |
| `settings.integrations.<service>` | `integrations:`, a list, so you can connect two of a kind. Ones you'd never set up are dropped. |
| `settings.alerts.webhookUrl`, `.type`, `.email` (the single alert webhook and email from before 2.13) | the first entries of `settings.alerts.channels`, sending as they did |

Your `CTRLCENTER_*` environment variables keep working for the services and
the calendar they were set for. New ones can be referenced as `${NAME}` in any
integration field.

**Rolling back.** 2.x can't read a 3.0 config: 2.13 stops with an error naming
the newer config version, rather than silently dropping what it doesn't
understand. To go back,
stop the container, restore the backup over the live file
(`cp config/config.v2.bak.yaml config/config.yaml`), and run the `:2.13`
image. Anything you changed after upgrading is lost.

## Configuration

Edit through **/admin** (recommended) or by hand — changes are picked up on the
next page load, no rebuild. The main sections:

```yaml
schemaVersion: 3            # written for you; older files migrate on first start
settings:
  title: ctrlcenter         # browser tab title
  timezone: America/Chicago # IANA timezone, used for the date + greeting
  theme:                    # site-wide default (visitors can override in /settings)
    mode: system            # system | light | dark
    design: glass           # glass aero flat soft minimal bold cyber clay frost outline paper gradient aura emboss carve stripe sketch console
    scene: aurora           # aurora abyss nebula grid starfield waves rays traces dots horizon orbit peaks rain fireflies blueprint prisms petals comets none
    font: jakarta           # jakarta inter poppins nunito lora jetbrains outfit grotesk manrope rubik playfair quicksand
    accentFrom: '#a78bfa'   # accent gradient start (#rrggbb)
    accentTo: '#22d3ee'     # accent gradient end (same as start = solid)
    # Optional fixed default colors (override light/dark mode). Set in pairs:
    # background: '#06070d'       # dark surface / ink
    # foreground: '#f4f4f6'
    # backgroundLight: '#eceef3'  # light surface / ink
    # foregroundLight: '#181b24'
    # Optional, each also with a *Light twin for light mode (best set in the
    # theme builder, then "set as site theme", or in Settings → General):
    # designLight / sceneLight / fontLight   # a different look for light mode
    # tune: { radius: 100, border: 100, blur: 100, shadow: 100, fill: 100, glow: 100 }  # percent of the design's own
    # sceneIntensity: 100         # 0–100; sceneMotion: normal | calm | off
    # headingFont: lora           # titles in their own face; density: compact | comfortable | spacious
    # status: { up: '#22c55e', down: '#ef4444', warning: '#f59e0b', info: '#38bdf8' }
    # wallpaper: { src: "https://…/photo.jpg", blur: 8, dim: 40, fit: cover }  # fit: cover | contain | tile
  visitorTheming: all       # what visitors may change: all | packs (the gallery
                            # and light/dark only) | none (kiosks); admins always may
  themeSchedule:            # a day and a night theme by time of day
    enabled: false
    mode: sun               # sun (sunrise/sunset at the weather location) | fixed
    day: Daybreak           # gallery theme names; "" = the theme above
    night: Observatory
    dayStart: "07:00"       # for fixed mode, in the site's time zone
    nightStart: "19:00"
    # dayMode: light        # an appearance mode per phase; nightMode: dark
  statusChecks: false       # ping app URLs, show online/offline dots + /status
  statusInterval: 5         # minutes between background uptime checks (1–60)
  statusDefaultRange: d1    # range /status opens on: h1 | d1 | d30 | d90 (= 1h/24h/30d/90d)
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
    confirmations: 2        # consecutive failed checks before "down" (flap dampening)
    channels:               # any number; each type reads only its own fields
      - id: discord
        type: webhook       # webhook | email | telegram | gotify | pushover | apprise
        format: discord     # webhook payload: generic | discord | slack | ntfy
        url: ""
      - id: phone
        type: telegram
        token: ""           # from @BotFather
        chatId: ""
        onRecovery: false   # also onDown, onWarning, onWebhooks (inbound events); all default true
        apps: [plex]        # only these app ids; leave out for every app
      - id: mail
        type: email
        smtp:
          host: mail.smtp2go.com
          port: 587         # 587/STARTTLS, or 465 with secure: true
          from: ctrlcenter@example.com
          to: you@example.com
          # user: ""        # SMTP username
          # pass: ""        # or set the CTRLCENTER_SMTP_PASS env var instead
    # Before 2.13 there was one webhook (type, webhookUrl) and one email
    # section; upgrading to 3.0 turns them into the first entries here.
  settingsButton: true      # the floating corner navigation menu
  # Further sections mirror the admin UI one-to-one and are easiest to edit
  # there: favicon, announcement (the site-wide banner), statusAnnouncements,
  # and webhooks (inbound service events).
  layout:                   # shared by every board:
    scale: 100              # UI scale, percent
    gap: 32                 # space between cards (px)
    topGap: 64              # space above the first row (px)

themes:                     # the theme gallery visitors pick from, in this order
                            # (Settings → Themes). Empty = the built-ins as shipped.
  - { key: Tide, builtin: Tide, name: Surf }        # a built-in, renamed
  - { key: Outrun, builtin: Outrun, hidden: true }  # a built-in hidden from visitors
  - key: custom-1a2b3c4d    # a theme of your own: name and both colorsets at
    name: Lab               # least; design, scene (and designLight/sceneLight),
    design: console         # tune, font, headingFont, status/statusLight and
    scene: grid             # wallpaper/wallpaperLight as under theme: above
    dark: { background: '#06070d', foreground: '#f4f4f6', accentFrom: '#22c55e', accentTo: '#22d3ee' }
    light: { background: '#eceef3', foreground: '#181b24', accentFrom: '#15803d', accentTo: '#0e7490' }
  # Built-ins left out stay as shipped, after the ones listed.

boards:                     # the dashboards; the first is the home page, the
                            # others live at /b/<id>. Best edited visually: sign
                            # in and pick "Edit layout" from the corner menu
  - id: home
    name: Home
    visibility: public      # public | private (only the signed-in admin)
    layout:
      sections:             # order = position; widgets flow row by row
        - { widget: greeting, span: 16 }    # `widget` names an instance below
        - { widget: headerCard, span: 8 }
        - { widget: clock, span: 8, hidden: true }    # split clock/weather/status
        - { widget: weather, span: 8, hidden: true }  #   widgets — show them as an
        - { widget: status, span: 8, hidden: true }   #   alternative to headerCard
        - { widget: search, span: 24 }
        - { widget: family, span: 12 }
        - { widget: work, span: 12 }
        - { widget: favorites, span: 24 }
        - { widget: apps, span: 24 }
        - { widget: bookmarks, span: 24 }
  - id: infra
    name: Infra
    visibility: private
    icon: proxmox           # optional, beside its name in the menus: a slug,
                            # an image URL or an uploaded icon, like an app's
    theme: Lab              # optional: a gallery theme pinned on this board
    layout:
      sections:
        - { widget: todo, span: 12 }
        - { widget: apps, span: 24 }        # a widget can sit on several boards

widgets:                    # every widget, with its content; any type can
                            # appear any number of times (one of each if left out)
  - { id: greeting, type: greeting }
  - { id: headerCard, type: headerCard, showClock: true }
  - { id: family, type: calendar, url: "https://…/family.ics" }
  - { id: work, type: calendar, url: "https://…/work.ics", homeView: month }
  - { id: todo, type: notes, title: To do, content: "- renew certs" }
  - { id: media-apps, type: apps, title: Media, filter: { group: media } }
  - { id: private-apps, type: apps, title: Private, filter: { private: only } }
  - { id: bookmarks, type: bookmarks }  # filter: { group: … } for one group
  - { id: nas, type: api, title: NAS, url: "http://nas.lan/api/pool",
      headers: [{ name: Authorization, value: "Bearer ${NAS_TOKEN}" }],
      display: gauge, fields: [{ label: Used, path: $.used_pct, unit: "%" }],
      thresholds: { warn: 80, critical: 95 } }   # visibility: public to share
  # …and the other types: clock, weather, status, search, feed, countdown,
  # worldClocks, systemStats, favorites, integration. A widget without a
  # row on a board waits, hidden, in that board's layout editor tray.

integrations:               # the private Monitor page's connections, any number
                            # of each type (best edited in Settings → Integrations)
  - { id: sonarr, type: sonarr, url: "http://sonarr:8989", apiKey: "${SONARR_KEY}" }
  - { id: sonarr-4k, type: sonarr, name: Sonarr 4K, url: "http://sonarr4k:8989",
      apiKey: "${SONARR_4K_KEY}" }   # ${NAME}: read from the environment
  - { id: portainer, type: portainer, url: "https://portainer:9443",
      apiKey: "${PORTAINER_TOKEN}", allowActions: true }

groups:                     # what apps and bookmarks are sorted into, in order
  - { id: media, name: Media, icon: jellyfin, color: violet }  # icon and color
  - { id: shopping, name: Shopping }  # optional; color: violet | sky | emerald
                                      # | amber | rose

apps:
  - id: <uuid>
    name: Cloud Drive
    subtitle: Nextcloud
    url: "https://cloud.example.com"
    icon: nextcloud          # slug, full image URL, or uploaded icon
    group: media             # optional: a group id
    tags: [files, backup]    # optional: an apps widget can show one tag
    checkType: http          # http | tcp | keyword | dns | icmp
    expectStatus: ""         # http: codes/ranges that count as up, e.g. "200-299, 401"
                             # (blank = any reachable host is up)
    # port: 5432             # tcp: port to connect to (else the URL's port, or 443/80)
    # keyword: "Welcome"     # keyword: text that must appear in the response body

bookmarks:
  - id: <uuid>
    group: shopping          # the group it's listed under
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
| `ADMIN_PASSWORD` | yes | Bootstrap password for `/admin`. After you set one in **Settings → Reset password**, login uses that. **Special characters:** quote the value in `.env` and double any literal `$` as `$$` (docker compose interpolates `$`), or a complex password can be mangled before the app sees it. |
| `SESSION_SECRET` | no | Secret used to sign session cookies. If unset, a random one is generated on first start and kept in the config volume (`session-secret`); only if that volume isn't writable does it fall back to deriving one from `ADMIN_PASSWORD`. Set it yourself to manage the secret explicitly (e.g. `openssl rand -base64 32`). |
| `CONFIG_PATH` | no | Path to the config file (default `./config/config.yaml`; the container sets `/config/config.yaml`). The uptime history (`status-history.db`, a SQLite database) and uploaded custom icons (`uploads/`) are written beside it. |
| `CTRLCENTER_SMTP_PASS` | no | Overrides the email-alert SMTP password, so the secret can stay out of `config.yaml`. |
| `CTRLCENTER_CALDAV_PASS` | no | Overrides the private-calendar (CalDAV/WebDAV) password of the calendar widget with id `calendar` (the one a 2.x config migrates to), so that secret can stay out of `config.yaml` too. Other calendar widgets use only their own stored credentials. |
| *any name* | no | Referenced from an integration as `${NAME}`: any of its fields (URL, username, password, API key) can name an environment variable instead of holding the value, e.g. `apiKey: "${SONARR_4K_KEY}"`. Read on the server at use time; never shown in the admin or sent to a browser. |
| `CTRLCENTER_QBITTORRENT_PASS`, `CTRLCENTER_SONARR_KEY`, `CTRLCENTER_RADARR_KEY`, `CTRLCENTER_ADGUARD_PASS`, `CTRLCENTER_TAUTULLI_KEY`, `CTRLCENTER_SEERR_KEY`, `CTRLCENTER_PORTAINER_KEY`, `CTRLCENTER_TRUENAS_KEY`, `CTRLCENTER_UNIFI_PASS` | no | The pre-3.0 per-service names. Each still overrides the password or key of the integration whose id is the service's name (the one a 2.x config migrates to, e.g. `sonarr`); further integrations of the type use `${…}` references instead. |
| `CTRLCENTER_WEATHER_API` | no | Base URL the *server* uses for weather requests (default `https://api.open-meteo.com`). Point it at a [self-hosted Open-Meteo](https://open-meteo.com/en/docs#self-hosting) instance to keep weather traffic on your own network; it must speak the same `/v1/forecast` API. A visitor who sets their own location still fetches from the public API client-side. |
| `CTRLCENTER_HOST_PROC` | no | Where the System stats widget looks for a host-mode `/proc` mount (default `/host/proc`). In a container the widget normally reports the *container's* cgroup-scoped CPU/memory; to show the host machine instead, bind-mount the host's `/proc` read-only — `-v /proc:/host/proc:ro` (compose: `- /proc:/host/proc:ro`) — and the widget switches to host mode automatically, no privileges needed. Disks are separate: a path must be mounted into the container to be measured. |
| `CTRLCENTER_ICON_CACHE_MAX_BYTES` | no | Cap, in bytes, on the on-disk cache of icons fetched from the icon CDN (stored beside your config). Default `67108864` (64 MB) — far more than any real dashboard uses. When the cap is exceeded, the least-recently-served icons are evicted (and simply re-fetched next time they're needed). Lower it on a very small data volume. |
| `LOG_LEVEL` | no | Server log verbosity: `debug`, `info` (default), `warn`, or `error`. Diagnostics — a timed-out weather/feed/calendar fetch, a rejected alert — are logged to the container's stdout/stderr. |
| `TRUSTED_PROXY_HOPS` | no | Number of trusted reverse proxies in front of the app, used to find the real client IP in `X-Forwarded-For` for login throttling. Default `1` (the app sits behind one reverse proxy). **Set `0` if the app is exposed directly** — the Docker image then throttles each client by its actual connection address; otherwise a client can spoof `X-Forwarded-For` to forge a fresh source IP per request and slip past the per-IP login throttle. A global attempt cap still applies as a backstop, but the per-IP limit is your first line of defense. (Run outside the image — `next start` — the app can't see connection addresses, so with `0` every client shares one limit.) |

## Development

Requires **Node.js 24+** (the version CI and the Docker image use).

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

- [`lib/config/`](lib/config/) reads/writes `config.yaml`, validated by
  [`lib/schema.ts`](lib/schema.ts) (zod).
- [`lib/auth.ts`](lib/auth.ts) + [`proxy.ts`](proxy.ts) gate `/admin` with a
  signed-cookie session, enforced by the Next.js middleware (which also sets a
  per-request CSP nonce).
- `components/scenes/` are the animated backdrops; the theme builder lives in
  [`components/ThemeBuilder.tsx`](components/ThemeBuilder.tsx) and persists
  per-visitor prefs via [`components/PrefsProvider.tsx`](components/PrefsProvider.tsx).
  [`lib/theme-paint.ts`](lib/theme-paint.ts) is the one theme resolver: the
  no-flash inline script in the root layout is its source run in the browser,
  and the hydrated paint uses the same instance, so the two can't drift.
- [`instrumentation.ts`](instrumentation.ts) starts the background uptime poller
  ([`lib/status-poller.ts`](lib/status-poller.ts) → [`lib/status-history/`](lib/status-history/)),
  which also drives down/recovery [`alerts`](lib/alerts.ts).
- [`lib/calendar-fetch.ts`](lib/calendar-fetch.ts) fetches the iCal agenda
  feed (server-side, cached); [`lib/calendar.ts`](lib/calendar.ts) parses it
  (with recurrence expansion) and holds the client-safe display helpers;
  [`lib/search.ts`](lib/search.ts) resolves search bangs.
- `app/api/` holds the admin CRUD/reorder routes plus `status`,
  `status/history` (the list, each service's detail with its outage log, and
  the admin's incident notes), and `health`.

## License

[MIT](LICENSE) © boostctrl
