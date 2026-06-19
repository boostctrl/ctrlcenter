# Homepage

A self-hosted homepage dashboard: applications grid, categorized bookmarks,
live date/greeting header, and a weather widget. Built with Next.js +
Tailwind, configured through a single YAML file, with a built-in admin UI
for adding/editing apps and bookmarks without touching the file by hand.

## Quick start (Docker Compose)

1. Copy the env file and set an admin password:
   ```bash
   cp .env.example .env
   # edit .env and set ADMIN_PASSWORD
   ```
2. Build and run:
   ```bash
   docker compose up -d --build
   ```
3. Open `http://localhost:3000` for the dashboard, `http://localhost:3000/admin`
   to manage apps/bookmarks/settings (sign in with `ADMIN_PASSWORD`).

Your data lives in `./config/config.yaml`, bind-mounted into the container.
You can edit it by hand (changes are picked up on the next page load — no
rebuild needed) or through the `/admin` UI, which writes back to the same
file.

## Configuration

`config/config.yaml` has three sections:

```yaml
settings:
  title: Home              # browser tab title
  greetingName: ""         # optional, "Good evening, <name>!"
  timezone: America/Chicago # IANA timezone, used for date + greeting
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

## Project structure

- `lib/config.ts` — reads/writes `config.yaml`, validated with `lib/schema.ts`
- `lib/auth.ts` / `middleware.ts` — password-gated admin session (signed cookie)
- `app/page.tsx` — public dashboard
- `app/admin/` — password-protected management UI
- `app/api/` — CRUD routes backing the admin UI
