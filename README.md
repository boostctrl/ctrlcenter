# Homepage

A self-hosted homepage dashboard: applications grid, categorized bookmarks,
a live date/greeting header with a ticking clock, and a weather widget. Built
with Next.js + Tailwind, configured through a single YAML file, with a built-in
admin UI for adding/editing apps and bookmarks without touching the file by
hand.

Features:

- **Instant search** across apps and bookmarks — press `/` to focus, `Esc`
  to clear.
- **Drag-to-reorder** apps and bookmarks in the admin UI; order is saved back
  to the YAML file.
- **Installable** as a PWA (web app manifest) and exposes `/api/health` for
  container/orchestrator health checks.

## Quick start (Docker Compose)

1. Copy the env file and set an admin password:
   ```bash
   cp .env.example .env
   # edit .env and set ADMIN_PASSWORD (and, recommended, SESSION_SECRET)
   ```
2. Pull the published image and run:
   ```bash
   docker compose pull
   docker compose up -d
   ```
   The bundled [docker-compose.yml](docker-compose.yml) uses the prebuilt image
   `ghcr.io/boostctrl/homepage-app:latest`. To build from source instead,
   comment out `image:` and uncomment `build: .`, then run
   `docker compose up -d --build`.
3. Open `http://localhost:3000` for the dashboard, `http://localhost:3000/admin`
   to manage apps/bookmarks/settings (sign in with `ADMIN_PASSWORD`).

## Environment variables

| Variable         | Required | Description                                                                                                                                      |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADMIN_PASSWORD` | yes      | Password for the `/admin` UI.                                                                                                                     |
| `SESSION_SECRET` | no       | Secret used to sign session cookies. If unset, the key is derived from `ADMIN_PASSWORD`, so changing the password logs everyone out. Generate one with `openssl rand -base64 32`. |
| `CONFIG_PATH`    | no       | Path to the config file (defaults to `./config/config.yaml`; the container sets `/config/config.yaml`).                                           |

Your data lives in `./config/config.yaml`, bind-mounted into the container.
You can edit it by hand (changes are picked up on the next page load — no
rebuild needed) or through the `/admin` UI, which writes back to the same
file. The admin header also has **Export**/**Import** buttons to download a
JSON backup of the whole config and restore it later.

The container fixes ownership of the bind-mounted `./config` directory on
startup and runs the app as a non-root user, so this works no matter who owns
the host directory — no manual `chown` required.

## Configuration

`config/config.yaml` has three sections:

```yaml
settings:
  title: Home              # browser tab title
  greetingName: ""         # optional, "Good evening, <name>!"
  timezone: America/Chicago # IANA timezone, used for date + greeting
  accent: violet           # violet | blue | emerald | rose | amber | cyan
  statusChecks: false      # ping app URLs and show online/offline dots
  search:
    engine: duckduckgo     # duckduckgo | google | bing | brave | custom
    customUrl: ""          # used when engine: custom; must contain %s
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
    icon: nextcloud          # icon slug or full image URL
bookmarks:
  - id: <uuid>
    category: Shopping       # bookmarks are grouped by category
    name: Amazon
    url: "https://amazon.com"
    icon: amazon
```

### Icons

Set `icon` to a slug from the [dashboard-icons](https://github.com/homarr-labs/dashboard-icons)
set (e.g. `plex`, `nextcloud`, `youtube`) and it's resolved automatically. If
a slug isn't in that set, paste a direct image URL instead — anything
starting with `http://` or `https://` is used as-is. The admin UI shows a
live icon preview as you type.

## Local development

Requires Node.js 22+.

```bash
npm install
npm run dev
```

The app reads/writes `config/config.yaml` relative to the project root in
dev (override the path with the `CONFIG_PATH` env var). Set `ADMIN_PASSWORD`
in a `.env.local` file to use the admin UI locally.

### Tests

Unit tests (Vitest) cover the config read/write logic, schema validation,
auth, and the login rate limiter:

```bash
npm test         # run once
npm run test:watch
```

## Project structure

- `lib/config.ts` — reads/writes `config.yaml`, validated with `lib/schema.ts`
- `lib/auth.ts` / `proxy.ts` — password-gated admin session (signed cookie),
  enforced by the Next.js proxy middleware
- `lib/rate-limit.ts` — in-memory login throttling
- `app/page.tsx` / `components/Dashboard.tsx` — public dashboard + client-side
  search/filter
- `app/admin/` — password-protected management UI (drag-to-reorder lives in
  `components/admin/`)
- `app/api/` — CRUD + reorder (`PATCH`) routes backing the admin UI, plus
  `app/api/health`
- `app/manifest.ts` — generated web app manifest
- `.github/workflows/` — CI (lint + test + build) and the release pipeline

## Releasing

Branching model: day-to-day work lands on `develop`; `main` tracks released
code. Every push/PR to either branch runs CI
([`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint, tests, build).

To cut a release:

1. On `develop`, update [`CHANGELOG.md`](CHANGELOG.md): rename the
   `[Unreleased]` heading to the new version with today's date (keeping the
   [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) sections), add a
   fresh empty `[Unreleased]` section above it, and update the link
   references at the bottom. Bump `version` in `package.json` to match.
2. Merge `develop` into `main`.
3. Tag the release and push the tag:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

Pushing a `v*` tag triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which:

1. re-runs the tests;
2. builds a multi-arch (`linux/amd64`, `linux/arm64`) image and publishes it
   to `ghcr.io/boostctrl/homepage-app` tagged `X.Y.Z`, `X.Y`, and `latest`; and
3. creates the GitHub release, with notes extracted from the matching
   `CHANGELOG.md` section (so the release will fail if that section is
   missing — keep step 1 above honest). Tags containing a hyphen
   (e.g. `v1.0.0-rc1`) are published as pre-releases.

> The GHCR package is private until you set it to public in the repository's
> Packages settings — do this once if you want others to pull without auth.
