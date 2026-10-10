# CtrlCenter 3.0 roadmap

_Analysis of `develop` @ `7b30a69` (v2.10.1), 2026-10-09. Built from three
audits: the codebase (architecture, complexity, flexibility), the rendered app
(desktop and mobile, light and dark, axe-core, keyboard, first run), and the
competition (Homepage, Homarr, Dashy, Glance, Heimdall, Homer, Organizr,
Flame, Uptime Kuma). Every confirmed defect is filed (#269–#279), and each
release has a tracker issue with one sub-issue per item: 2.11 #280, 2.12 #281,
2.13 #282, 3.0 #283, and the post-3.0 backlog #284. The theming project
was added 2026-10-10 (see "3.0 — Theming depth", tracker #324)._

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

> **Status: released as 2.13.0** (2026-10-09).
> All six items are closed, plus three found along the way (#309, #310,
> #311). What users notice:
> - Each app can have its own check interval, timeout and retries, can be left
>   unmonitored, and can use the new JSON query, push (heartbeat) and TLS
>   certificate checks.
> - Alerts go to any number of channels: webhooks, email, Telegram, Gotify,
>   Pushover and Apprise, each with its own events, apps and Send test. Apps
>   that start warning (a certificate near expiry) alert too.
> - Maintenance windows hold alerts and keep planned downtime out of uptime.
> - Each app has an SVG badge, and the status page has an Atom feed.
> - Export now carries incident notes.

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
| G | **Layout editor 2.0.** Grab a card anywhere to move it, by mouse or touch, with a live preview of where it lands. Resize it from its edge or corner (#312). The editor shows the page as visitors see it: click a card to bring up its controls, and move or resize it from the keyboard (#313). An "Add widget" palette configures a widget right in the editor, instead of in Settings first. Editing works per board. Also fixes undo and adds redo (#314), and fixes the tray's Show (#315). Cards keep flowing into place rather than sitting at fixed grid positions; see #312. | XL | #303 |
| H | **First-run setup.** Detect a missing password (#275), then a short flow: location and time zone, first apps (with optional starter content), status checks on or off. | M | #304 |
| I | **Drop legacy shims.** The 1.x layout heuristics, `settings.components`, retired scene ids, bare-string localStorage prefs, the two-element history tuples, and the alias for the old settings deep link. | S | #305 |
| J | **Upgrade path.** On first start, migrate v2 to v3 automatically and write `config.v2.bak.yaml` next to it. The admin UI shows a one-time banner with what changed. The release notes explain rolling back: restore the backup and pin `:2.13`. | M | #306 |

**Beta plan**
- **beta.1:** A–D. The new config model, with the UI at parity.
- **beta.2:** E–G. The new capabilities.
- **rc:** H–J, the theming project (see "3.0 — Theming depth", #324),
  plus docs and help.
- **3.0.0:** after a quiet rc.

---

## 3.0 — Theming depth

_Added 2026-10-10. Audit of `develop` @ `9b6f46c`: the theme code
(`lib/theme.ts`, `lib/prefs.ts`, `components/prefs/`, `components/theme-builder/`,
`app/globals.css`, the inline no-flash script), a contrast sweep of every
built-in palette and theme in both modes, and the rendered builder and
design matrix in Playwright Chromium._

Theming is the strength no competitor matches, so it ships in 3.0 as a
deliberate project rather than a grab-bag. The aim is two things at once:
**polish** (every built-in look is correct and distinct, the builder shows
you what you are doing) and **depth** (more to control, without more to
learn: fine-tuning layers over the existing designs and scenes instead of
replacing them).

### What the audit found

**Solid.** Light and dark are fully independent looks. Every surface reads
design tokens, so 18 designs × 18 scenes × 21 palettes × 12 fonts compose
freely. The no-flash script paints the right theme before hydration. Saved
themes carry both modes, export and import, and promote to the site default.
Admin overrides of the built-in packs survive renames (3.0 migration).

**Defects.**

| Finding | Issue |
|---|---|
| The ink on accent buttons is picked from the *average* of both gradient stops, but the button paints only the first. 29 of 66 built-in palette/theme modes land under 4.5:1 (Monokai dark 1.6:1, Forest dark 1.9:1). Picking per painted stop fixes all but one. | #321 |
| `text-ink-NN` lifts opacity by one constant per mode, tuned for the default colors. On the other palettes, `text-ink-40` is under 4.5:1 in 28 of 66 modes and `text-ink-50` in 6. The smoke audit only renders the default theme, so it never sees this. | #322 |
| Console, Sketch, Minimal and Outline look alike in light mode. | #308 |

**Gaps.**

- The builder gives no feedback on what is active: theme and palette tiles
  are one-shot actions with no selected state, swatches are a gradient bar
  that says nothing about the design or scene, and the only preview is the
  page behind the builder, which on a phone is off-screen.
- There is no way to turn a scene off, dim it, or slow it. Motion follows
  only the OS reduced-motion setting.
- Colors stop at four: background, ink, two accent stops. Card tint, secondary
  text and the status colors (red/amber/emerald/sky, ~90 hard-coded uses) are
  not themeable, and the group-color palette is fixed.
- Designs are fixed recipes: radius, border, blur, shadow and glow are tokens
  already, but nothing exposes them.
- Fonts: one face for everything, no heading face, no size or density.
- The admin can recolor the 12 built-in packs but cannot add, hide or reorder
  packs, and edits them through selects with no preview.
- Theme resolution is written three times (inline script, `themeApply.ts`,
  `scenes/color.ts`) and must be kept in sync by hand.

### Work items

| # | Item | Size | Issue |
|---|---|---|---|
| T1 | **Accent ink by contrast.** Pick `--accent-fg` by WCAG contrast against the stop that is painted, in `applyAccent` and the inline script; deepen `gradient-text` on light surfaces the way scenes already are. | S | #321 |
| T2 | **Ink lift per theme, and a theme-matrix smoke pass.** Derive `--ink-lift` from the applied foreground/background contrast so `text-ink-*` holds 4.5:1 on every palette. Extend `npm run smoke` to render the home page under every built-in pack in both modes with the axe audit. | S | #322 |
| T3 | **One theme resolver.** Generate the no-flash script's logic from the same module `themeApply.ts` and `scenes/color.ts` use (a pure function serialized at build time), so the three copies can't drift. | S | #325 |
| T4 | **Light-mode signature traits** for Console, Sketch, Minimal and Outline. | S | #308 |
| T5 | **Fine-tune tab.** Sliders layered over the chosen design: corner radius, border weight, blur, shadow depth, card opacity, glow intensity. Stored per mode with the theme, exported with it, and resettable to the design's own values. The design stays the recipe; the tune is a delta. | M | #326 |
| T6 | **Scene controls.** A *None* scene; per-scene intensity (opacity) and motion (off, calm, normal) that also honor a per-visitor reduce-motion switch independent of the OS. | S | #327 |
| T7 | **Builder that shows its work.** A live preview card pinned beside the tabs (greeting, an app card, a button, status dots, text at every ink level) for the mode being edited; the active theme, palette, design, scene and font highlighted; theme tiles that render their design and scene, not a gradient bar; a *Modified* state with one-tap revert to the last applied theme. | M | #328 |
| T8 | **Share a theme as text.** Copy a theme as a short code or link and paste one in, alongside the file export. | S | #329 |
| T9 | **Typography.** A heading face separate from the body face, a size/density step (compact, comfortable, spacious), tabular numerals for clocks and stats, and packs that can carry a font. | M | #330 |
| T10 | **Semantic colors as tokens.** Status (up, down, warning, info) and group colors become theme tokens with light and dark pairs, derived from the palette by default so existing looks don't change, editable in the builder. Replaces the hard-coded Tailwind shades. | M | #331 |
| T11 | **Palette from one color.** Pick an accent and derive background, ink, secondary stop and the semantic set for both modes in OKLCH with contrast guaranteed; an *Auto-pair* action next to the custom pickers. | M | #332 |
| T12 | **Wallpaper.** An uploaded or linked image behind the scene, with blur and dim controls, per mode. Uploads and the `img-src https:` CSP already allow it. | M | #333 |
| T13 | **Admin theme gallery.** `themes:` holds whole packs, not only overrides: add, duplicate, hide and reorder packs, and preview them live in the Themes tab. Additive config; existing overrides migrate to entries that reference their built-in. | M | #334 |
| T14 | **Visitor theming policy.** Admin chooses what visitors may change: everything, packs only, or nothing (kiosks, shared screens). | S | #335 |
| T15 | **Scheduled themes.** Switch between two site themes by time of day, with sunrise and sunset from the weather location. Pulls the schedule half of the 3.1 kiosk item forward; weather-reactive scenes stay in 3.1. | M | #336 |
| T16 | **Per-board theme.** A board can pin its own theme on top of the site default. Builds on 3.0 boards. | M | #337 |

**Decided (2026-10-10): all sixteen items ship in 3.0.** Tracker #324, one
sub-issue per item. T1–T8 are the polish core and land first; T9–T16 are
the depth items, each independent of the others. Every item is additive to
the v3 config.

**Principles.**
- Nothing here changes an existing visitor's or admin's look. New knobs
  default to the current behavior.
- Every built-in look passes the axe audit in both modes, enforced by T2.
- A new design, scene or font stays a one-registry addition; a `new-scene`
  skill joins `new-widget` once T6 lands.

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
