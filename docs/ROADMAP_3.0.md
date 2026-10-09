# CtrlCenter 3.0 roadmap

_Analysis of `develop` @ `7b30a69` (v2.10.1), 2026-10-09. Built from three
audits: the codebase (architecture, complexity, flexibility), the rendered app
(desktop and mobile, light and dark, axe-core, keyboard, first run), and the
competition (Homepage, Homarr, Dashy, Glance, Heimdall, Homer, Organizr,
Flame, Uptime Kuma). Every confirmed defect is filed (#269–#279), and each
release has a tracker issue with one sub-issue per item: 2.11 #280, 2.12 #281,
2.13 #282, 3.0 #283, and the post-3.0 backlog #284._

## Where things stand

**Strengths to protect.** Nothing else in this category combines them:

- **Homepage and status page in one container.** The status page has a 90-day
  timeline, an outage log with incident notes, announcements, and alerts with
  flap dampening. Competitors show up/down dots, or tell you to run Uptime Kuma
  or Gatus next to them.
- **Config as a file *and* a UI.** Homepage has no UI editor, and its
  community is building third-party ones. Homarr keeps its config only in a
  database, and reviewers complain that's hard to track in git.
- **Theming depth.** 18 designs, 18 animated scenes, palettes, fonts and
  per-visitor overrides. No competitor comes close.
- **Security posture for one owner.** Route-level auth, CSRF, TOTP, a login
  throttle that works without a proxy, and env-only secrets.

**What holds it back**

| Area | Finding |
|---|---|
| Flexibility | One home page and one layout. Every widget except feeds can appear only once. Apps are a flat list. Each of the 9 integration types allows a single instance, and integration data never reaches the home grid. There's one admin. |
| Complexity | A new widget touches about 10–12 files across seven parallel id lists. A new integration touches about 9. Caching with background refresh is written 4 times, and client polling 7 times. `Dashboard.tsx` (1,055 lines) has a big switch per widget. `updateSettings` has 14 hand-written merge branches. |
| Data | Every admin save rewrites `config.yaml` and drops its comments (#279). `status-history.json` is rewritten in full on every poll, and every app is checked twice (#278). Migrations guess the config version from its shape instead of reading `schemaVersion`. |
| Polish | Edit layout is unusable on phones (#271). Light mode fails WCAG contrast in 15 of 18 designs (#273). Keyboard focus is barely visible (#274). With no password set, login just says "Invalid password" (#275). A cold page load is 1.85 MB, 1.2 MB of it icon metadata (#276). See also #269, #270, #272 and #277. |
| Tests | 47 test files cover `lib/` logic only. There are no route-handler or component tests, and none for the status poller. |

**The market moved this summer.**
- Homepage 2.0 (August) added an OIDC login gate and an MCP server.
- Homarr 2.0 (2 October) added Docker-label discovery, custom JSX widgets
  and 31 more integrations.

What users across these tools ask for most:
1. OIDC or forward-auth, with visibility per group.
2. A generic API widget, and more integrations.
3. Docker auto-discovery.
4. Multiple boards or tabs.
5. i18n.
6. Action buttons (Wake-on-LAN, webhooks).

## The road to 3.0

```
2.11 Polish ─▶ 2.12 Foundations ─▶ 2.13 Status depth ─▶ 3.0.0-beta.N ─▶ 3.0.0 ─▶ 3.1+
 (no config      (internal; no        (additive config)     (config v3,
  changes)        user-facing                                 auto-migrated)
                  config change)
```

**Principles**
- **Break the config once, in 3.0.** The break comes with an automatic
  migration and a backup copy. Every 2.x minor reads and writes today's
  format.
- **Each 2.x minor ships on its own** and gives users something visible.
  Foundations work rides along with polish where it can.
- **3.0 ships as betas first.** `release.sh 3.0.0-beta.1` already works. The
  pipeline marks `-` tags as pre-releases and they don't move `:latest`, so
  early adopters can opt in with `:3.0.0-beta.1`.
- **The YAML file stays the source of truth.** There's no config database,
  and no user database. Identity comes from the owner's identity provider
  (3.1).

Sizes: **S** ≈ under a day, **M** ≈ 1–3 days, **L** ≈ a week or more.

---

## 2.11 — Polish pass

> **Status: released as 2.11.0** (2026-10-09).
> All items below plus undo for deletes (#307). Results:
> - A cold `/` load dropped from 1.85 MB to about 357 KB.
> - `npm run smoke` now audits every page in both schemes with axe-core
>   (WCAG 2.1 AA plus best practices) and is clean.
>
> Split out: #308 (light-mode designs that look alike).

Fixes everything the UX audit found. No config changes.

| # | Item | Size | Issue |
|---|---|---|---|
| 1 | Mobile edit layout: a fixed, full-width bottom bar with Done always visible, a single compact control row per widget, and no horizontal overflow. Stop the desktop toolbar covering widgets. | M | #271 |
| 2 | Light-mode contrast: raise the secondary-text tokens across designs, add a visible up/down shape, and **add an axe check to `npm run smoke`** for both schemes. | M | #273 |
| 3 | Keyboard: one `:focus-visible` ring everywhere, a skip link, one Tab stop per app card, highlight the top search match, and a `<main>` landmark plus correct heading levels in admin. | M | #274 |
| 4 | Confirm dialog: an opaque surface, name the item, focus Cancel first, ARIA wiring, and an undo toast after deletes. | S | #269 |
| 5 | Mobile admin: fix the Apps overflow, scroll the active tab into view, put the Add form first, and stop the nav and header from wrapping. | S | #272 |
| 6 | Page weight: resolve icon variants server-side or serve a filtered, gzipped map; preload only the active font. Target under 400 KB for a cold `/`. | S | #276 |
| 7 | "No admin password set" message on login, and a warning at startup. | S | #275 |
| 8 | Night icon in the header card, and the washed-out weather emoji in light mode. | S | #270 |
| 9 | Grab-bag: floating gear overlap, stretched settings cards, Delete button style, light-mode scene scrim, a "Show on home" switch inside each widget's settings card, a hint on Check method when checks are off, an integration toggle that waits for a URL, deep links from Monitor "Set up", refunding successful sign-ins to the throttle, the README 12→24 fix, the NUL byte in `lib/auth.ts`, and a table of contents on `/help`. | M | #277 |

## 2.12 — Foundations

> **Status: released as 2.12.0** (2026-10-09).
> All eight items are closed. What users notice:
> - Admin saves keep `config.yaml` comments, and only changed keys are written.
> - Each app is checked once per interval.
> - History lives in SQLite.
> - Background tabs stop polling.
> - A newer config is refused rather than silently downgraded.
>
> Underneath:
> - The widget registry (#285) is the base for 3.0's widget instances.
> - Settings input is derived from the schemas, with secrets marked in place.
> - The large modules are split.
> - The test suite has grown to 870 tests.

Internal changes that 3.0 depends on. Users see none of it beyond kept
comments and a lighter status system.

| # | Item | Size | Issue |
|---|---|---|---|
| F1 | **Widget registry.** One module per widget type with schema, defaults, label, render, empty state, admin editor and help entry. It replaces the seven parallel id lists in `lib/layout.ts`, the `blockFor` and `emptyReason` switches in `Dashboard.tsx`, and the per-widget props from `app/page.tsx`. A new widget becomes one folder. | L | #285 |
| F2 | **One server cache and one polling hook.** `swrCache(key, ttl, fetcher)` with dedupe of concurrent requests and stale-on-error replaces the copies in feed, calendar-fetch, monitor and `/api/status`. `usePolling(url, ms)` replaces the 7 hand-rolled intervals. | M | #286 |
| F3 | **Status: one source of truth.** `/api/status` serves the poller's readings instead of probing again. History moves to `node:sqlite`, built into Node 24, so a tick becomes a few inserts and retention a `DELETE`. Import the existing JSON once. Outage notes join config Export/Import. | M | #278 |
| F4 | **Comment-preserving config writes** with the `yaml` Document API. The atomic write and the write queue stay. | M | #279 |
| F5 | **Schema-driven config.** Derive the update schemas from the stored ones; this cuts about 200 lines of duplicated fields. Mark secrets in the schema so `stripSecrets` and `withoutEnvSecrets` stop being hand-maintained deny-lists. Replace the 14 merge branches with a generic merge driven by metadata. | M | #287 |
| F6 | **Versioned migrations.** Read `schemaVersion` and run a chain of steps (`v1→v2` frozen, `v2→v3` added in 3.0) instead of shape heuristics. | S | #288 |
| F7 | **Test infrastructure.** Route-handler tests: call the exported handlers with a `NextRequest`, covering monitor actions, hooks, settings, config import and status. Component tests with jsdom and Testing Library for Dashboard, LayoutEditor and the settings draft. Tests for the status poller. | M | #289 |
| F8 | **Split what's still large.** `PrefsProvider` into three contexts (location/units, look, favourites), which stops pref changes re-rendering everything. `config.ts` into store, migrate and CRUD. `status-history` into aggregate, store and query. Dashboard shrinks naturally after F1. | M | #290 |

## 2.13 — Status and alerts depth

Additive config only. This is the "Homepage + Uptime Kuma in one container"
release: it deepens the one area where CtrlCenter already leads.

| # | Item | Size | Issue |
|---|---|---|---|
| S1 | **Notification channels as a list**, so several webhooks and several email recipients are possible. Add Telegram, Gotify and Pushover, or one Apprise URL that covers 90+ services. The old single-channel keys keep working and move into the list in 3.0. | M | #291 |
| S2 | **Per-app check settings**: interval, timeout and retries. Today it's one global interval and a hard-coded 5-second timeout. | S | #292 |
| S3 | **Maintenance windows.** A scheduled announcement can mute alerts for the affected apps and paint the timeline as "maintenance" instead of "down". | M | #293 |
| S4 | **New check types:** TLS certificate expiry (warn N days ahead), push/heartbeat (a cron job pings a URL; silence counts as down), and JSON query (HTTP plus a check on a field value). | M | #294 |
| S5 | **SVG status badges** per app, and an incidents RSS/Atom feed. | S | #295 |
| S6 | **Every tile is a monitor.** When global checks are on, new apps are monitored by default with a sensible method guessed from the URL. | S | #296 |

---

## 3.0.0 — Boards and instances

The one breaking release. It's automatically migrated, and beta-tested first.

### The v3 config

```yaml
schemaVersion: 3

boards:                       # first board is the home page
  - id: home
    name: Home
    layout:
      columns: 24
      sections:
        - { widget: greeting }
        - { widget: search }
        - { widget: media-apps, span: 12 }
        - { widget: infra-apps, span: 12 }
        - { widget: notes-todo, span: 8 }
  - id: infra
    name: Infra
    visibility: private       # public | private  (groups in 3.1)
    layout: { sections: [ { widget: sonarr-4k-upcoming }, { widget: nas-pool } ] }

widgets:                      # every widget is an instance; content lives here
  - { id: media-apps, type: apps, title: Media, filter: { group: media } }
  - { id: infra-apps, type: apps, title: Infra, filter: { group: infra } }
  - { id: notes-todo, type: notes, title: To do, content: "…" }
  - { id: sonarr-4k-upcoming, type: integration, integration: sonarr-4k, view: upcoming }
  - { id: nas-pool, type: api, url: "http://nas/api/pool", map: { used: "$.used_pct" }, display: gauge }

apps:
  - { id: plex, name: Plex, url: "http://plex:32400", group: media, tags: [video] }

integrations:                 # an array: as many of each type as you run
  - { id: sonarr-4k, type: sonarr, url: "http://sonarr4k:8989", apiKey: "${SONARR_4K_KEY}" }
  - { id: sonarr-hd, type: sonarr, url: "http://sonarr:8989",   apiKey: "${SONARR_KEY}" }
```

### Work items

| # | Item | Size | Issue |
|---|---|---|---|
| A | **Widget instances.** Every widget type can appear any number of times, and its content lives on the instance. This removes `settings.<widget>`, `settings.components`, the header-prepend shim and the feed-only instance plumbing. It builds directly on F1. | L | #297 |
| B | **Boards.** Multiple dashboards, each with its own layout and visibility (public or signed-in only), switched from the page nav without widening the header. Board URLs are `/b/<slug>`; the home page is the first board. Weather, status and calendar stay as routes. | L | #298 |
| C | **App groups and tags.** An apps widget shows a group, a tag, or everything. Bookmarks use the same grouping, which replaces `groupPrivateApps` and the free-text category ordering. | M | #299 |
| D | **Integration instances.** The fixed keys become an array, so two Sonarrs or three Portainers are fine. Secrets use generic `${ENV}` references; the per-service env names migrate. Adding an integration type shrinks from about 9 touchpoints to 2: the client module plus its registry entry. | L | #300 |
| E | **Integration widgets on boards.** The same tile components drive the Monitor cockpit and the home grid. Tiles are admin-only by default; a per-widget "show to visitors" switch uses a redacted public view of the data, never the raw snapshot. | M | #301 |
| F | **Generic API widget.** URL, headers holding secret references, a JSONPath mapping, and a display style (stat, list, key/value or gauge). Refresh comes from the shared cache, size and timeout caps from `serviceRequest`, and a Test button from `runProbe`. Optional thresholds tint the tile; they feed alerts in 3.1. This answers the long tail of "a widget for X" requests without writing 160 adapters. | M | #302 |
| G | **Layout editor 2.0.** An "Add widget" palette with configuration inline, so you no longer configure a widget in Settings and then show it in the editor. Phone-friendly controls carried over from #271, and editing per board. | L | #303 |
| H | **First-run setup.** Detect a missing password (#275), then a short flow: location and time zone, first apps (with optional starter content), status checks on or off. | M | #304 |
| I | **Drop legacy shims.** The 1.x layout heuristics, `settings.components`, retired scene ids, bare-string localStorage prefs, the two-element history tuples, and the alias for the old settings deep link. | S | #305 |
| J | **Upgrade path.** On first start, migrate v2 to v3 automatically and write `config.v2.bak.yaml` next to it. The admin UI shows a one-time banner with what changed. The release notes explain rolling back: restore the backup and pin `:2.13`. | M | #306 |

**Beta plan**
- **beta.1:** A–D. The new config model, with the UI at parity.
- **beta.2:** E–G. The new capabilities.
- **rc:** H–J, plus docs and help.
- **3.0.0:** after a quiet rc.

---

## 3.1 and beyond

Ordered by user demand and by how well each one builds on 3.0:

1. **Identity without a user database.**
   - Trusted forward-auth headers (Authelia, Authentik, oauth2-proxy), plus
     native OIDC sign-in.
   - Group claims map to board and item visibility
     (`visibility: { groups: [family] }`).
   - Password plus TOTP stays as the fallback.
2. **Docker label discovery with an approval inbox.**
   - Reads `ctrlcenter.*` and existing `homepage.*` labels, through a Docker
     socket proxy or the Portainer integration.
   - Discovered services wait in an admin inbox with icon, monitor and bang
     pre-filled, and are added with one click instead of appearing silently.
3. **One-click import** from Homepage (`services/bookmarks/widgets.yaml`),
   Dashy, Homer, Heimdall, browser bookmark HTML, and Uptime Kuma backups
   (monitors and notifications). No competitor offers this.
4. **A command palette that acts.** `/` search gains actions: integration
   actions, Wake-on-LAN, outbound webhook buttons, "request <title>" through
   Seerr.
5. **API-widget alerts.** Thresholds feed the existing alert pipeline.
6. **More integrations, chosen by demand.** Jellyfin or Plex,
   Home Assistant, Proxmox, Pi-hole, Immich, Beszel. Cheap once D lands.
7. **Kiosk / ambient mode** for wall tablets: auto-refresh, burn-in
   protection, and scenes tied to the weather and time of day.
8. **A read-only MCP endpoint** for status and incidents: "what's down, since
   when, what did I note?"
9. **i18n**, if there's demand. The widget registry keeps strings in one place
   to make it feasible.

**Out of scope:** full multi-user accounts with their own database
(Homarr-style), and moving the config into a database.

## Decisions (resolved 2026-10-09)

1. **Status-history storage:** `node:sqlite`, with the existing JSON file
   imported once (#278).
2. **Configs older than 2.0 in 3.0:** a frozen `v1→v2` step stays in the
   migration chain, but the 1.x heuristics are no longer maintained (#288).
3. **Board URLs:** `/b/<slug>`, with the home board at `/` (#298).
4. **Monitor page:** it keeps its own cockpit design, built from the same tile
   components as board widgets (#301).
5. **Identity timing:** 3.1. The 3.0 visibility model (`public` / `private`)
   is built so group rules can be added later (#284).
