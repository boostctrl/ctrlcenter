# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release groups changes under **Added**, **Changed**, **Deprecated**,
**Removed**, **Fixed**, and **Security** (only the relevant sections appear).
The notes published with each GitHub release mirror that version's section
here.

## [Unreleased]

## [1.9.8] - 2026-07-14

### Added

- **A precipitation reading on the weather page.** The full forecast's stat
  tiles now show the current precipitation amount in your selected units (mm or
  inches), next to the existing chance-of-precip figure — the reading was
  already being fetched but had never been displayed. (#156)

### Fixed

- **The hourly forecast strip fills the full width of its card.** On wide
  screens the next 24 hours now spread edge to edge instead of leaving empty
  space on the right; narrower screens still scroll the strip as before. (#156)

### Removed

- **The weather page's visibility tile,** so the stat grid keeps the same
  compact size now that the precipitation reading has taken a slot. (#156)

## [1.9.7] - 2026-07-12

### Changed

- **The app's segmented toggles are now one consistent control.** The status
  page's range picker, the appearance-mode and units switches, the uptime-check
  interval and default-range pickers, the announcement kind, and the theme
  builder's mode and accent switches all share a single implementation, so they
  look and behave the same everywhere. As a bonus, any of them now shows a
  read-only chip when a hand-edited config value matches none of the presets —
  the control never looks like nothing is selected. (#140)

- **More horizontal strips fade at a clipped edge.** The admin tab row and the
  hourly forecast strip now fade out on whichever side has more to scroll to —
  the same cue the theme builder's tabs already used — so it's clear there's
  more content just off-screen. (#143)

### Fixed

- **A confirmation dialog can't be accepted by the keypress that opened it.**
  Pressing Enter to commit an action that then asks you to confirm — for
  example renaming a bookmark category onto an existing one, which asks before
  merging — now reliably opens the dialog and waits for a deliberate response,
  instead of that same in-flight Enter occasionally approving it on its own.
  (#146)

- **Duplicate saved-theme names are pointed out.** If two saved themes share a
  name (which older versions allowed), the theme builder now nudges you to
  rename them, so saving a look under that name updates the theme you mean
  rather than silently recapturing into whichever one came first. (#144)

## [1.9.6] - 2026-07-12

### Added

- **A World Clocks widget.** A new home-page card that shows the current time
  in the time zones you follow — one row per zone with its live clock and its
  own local date, so a glance tells you it's already tomorrow in Tokyo. Add
  zones (each with an optional label; leave it blank to use the zone's city
  name) under Settings → Widgets → World clocks. Like the other newer cards it
  ships hidden, so switch it on in the home-page layout editor once it's set
  up. (#79)

### Changed

- **The RSS feed widget can follow several feeds at once.** Add more than one
  RSS or Atom URL under Settings → Widgets → RSS feed and the card shows a
  single list merged newest-first, with each entry labelled by its source so a
  combined list stays readable. A slow or unreachable feed no longer empties or
  delays the card — it shows whatever the reachable feeds returned. The entries
  count now caps the combined list, and the card title falls back to the first
  feed's own title. (#107)

- **The in-app Help page is clearer and up to date.** The layout-editor
  section is now a scannable list (and documents the UI-scale control), the
  RSS and new World Clocks cards are described, and a few stale details are
  corrected: icons are fetched from an online set (so they need internet), and
  a note reminds you that a backup file holds your calendar and SMTP
  credentials in clear text. (#131)

### Deprecated

- **The old single-feed RSS setting.** A dashboard that pointed the RSS widget
  at a single URL keeps working untouched — that URL is read as a one-entry
  feed list — but the setting is superseded by the new feed list and will be
  removed in 2.0.0, which migrates any remaining single-feed config
  automatically. (#107)

### Fixed

- **The clock/weather/status header card scales cleanly at every width.** In
  the range between a desktop and a phone — where the card widens to fill the
  screen — the weather and clock no longer fly to opposite edges across a
  sparse gap; the card's contents stay a balanced, centered cluster. The
  narrow desktop card and the phone layout are unchanged. (#154)

- **Card grids drop a column before tile names get cut off.** When an
  applications, favorites, or bookmarks card is set to show several cards per
  row (or on a wide default dashboard), the grid now steps down to fewer,
  wider tiles as the card narrows instead of holding the column count until
  names ellipsize to half a word. A multi-word name like "Network Attached
  Storage" wraps onto a second line rather than being clipped. The earlier
  1.9.5 fix moved this to measure the card's own width, but the steps still
  fired too late; each step now leaves noticeably more room. (#145)

## [1.9.5] - 2026-07-11

### Added

- **A saved theme can be promoted to the site theme.** Signed-in admins get a
  globe button on each saved theme in the theme builder: one click (behind a
  confirmation) makes that look — colors, design, scene, and font, in both
  light and dark — the default every visitor sees. The promotion is a copy,
  so editing the saved theme afterwards doesn't silently restyle the site,
  and visitors' own customizations still apply on top. The site default can
  now also carry separate light-mode accent colors, so a theme with
  different accents per mode promotes faithfully. (#142)

- **Bookmarks can be marked "Only show when logged in", just like apps.** The
  bookmark form gains the same checkbox apps got in 1.9.4, for links that
  shouldn't be advertised to every visitor — an internal wiki, a router's
  admin page, a billing portal. A private bookmark disappears from the home
  page and its search results for signed-out visitors, and a category whose
  bookmarks are all private disappears with them; filtering happens on the
  server, so nothing about the bookmark reaches a signed-out browser. (#149)

### Changed

- **The admin portal remembers where you are.** The active tab — and inside
  Settings, the active section — now lives in the page address, so a refresh
  no longer bounces you back to Applications, and a link like
  `/admin?tab=settings&section=widgets` opens exactly that view. Alongside
  that, three small admin fixes: a login lockout now says how long to wait
  ("Try again in 4 minutes") instead of just "later"; the password dialog
  opens with its first field focused and keeps Tab inside the dialog (the
  confirmation dialog traps Tab too); and removing a middle custom-bang or
  countdown row can no longer confuse the rows below it. (#132)

- **Admin Settings is a shorter, single-column layout.** The settings rail is
  down to five entries — General, Home layout, Widgets, Announcement, and
  Security — and each opens a single top-to-bottom column of cards at a
  comfortable reading width instead of a two-column shuffle. Everything that
  configures a home-page widget now lives under **Widgets**: the search engine
  and custom bangs, weather, calendar, RSS feed, notes, countdown, and the
  status row with its alerts and status-page announcements, all in one place.
  (#134)

### Fixed

- **App tile names no longer truncate to half a word.** A tile's name now
  wraps to a second line before it ellipsizes, and the card grid steps down
  to three and four columns a little later, so an app called "Password
  Manager" reads as "Password Manager" — not "Passw…" — at every width.
  (#145)

- **Editing an app or bookmark now reports the real reason a save failed.** When
  saving a change to an application, a bookmark, or a bookmark category's name
  couldn't be written for a reason other than the item being gone — a full disk,
  a permissions problem — the admin used to see a misleading "Not found" for an
  item that was plainly still in the list. These now surface a proper save
  error, and "Not found" is reserved for an item that genuinely no longer
  exists. (#148)

### Security

- **Private items are now filtered at one enforced chokepoint instead of
  per-page convention.** Public pages read their configuration through a
  single accessor that has already removed private apps and bookmarks (and
  never carries the admin credential), and a test pins the short list of
  server paths allowed to see the unfiltered data — so a future page or API
  can't accidentally leak a private item by forgetting a filter. No behavior
  changes today; this hardens the guarantee the private flag makes. (#147)

## [1.9.4] - 2026-07-10

### Added

- **Apps can be marked "Only show when logged in".** A new checkbox in the
  application form keeps private services — a router admin, a hypervisor, a
  backup UI — off the dashboard for anyone who isn't signed in. The app
  vanishes from the home page, its search results and bang, the status page,
  and the public status feeds; filtering happens on the server, so nothing
  about the app reaches a signed-out browser. Monitoring and alerts still
  cover it. (#133)

- **Bookmarks reorder by dragging, just like applications.** Grab the ⠿ grip on
  a bookmark to drag it into a new spot within its category, or grab a category
  heading's grip to reorder whole categories. The ▲ / ▼ arrows are still there
  for keyboard and touch. (#127)

- **Bookmark categories can be renamed in place.** A pencil button on each
  category heading in the admin Bookmarks tab turns it into a text box — rename
  the category and every bookmark in it moves across in one step, keeping its
  spot in the category order. Renaming a category to the name of an existing one
  merges the two after a quick confirm. (#130)

- **Importing a configuration now confirms first and keeps a safety copy.**
  Choosing a file to import opens a confirmation that spells out what the file
  holds — how many apps and bookmarks, and the dashboard title it will set —
  before anything is replaced, since an import swaps your whole configuration
  at once. And whatever was live is written to `config.yaml.bak`, beside the
  config file, right before the import, so a mistaken or unwanted import is
  recoverable. (#129)

### Fixed

- **Card grids now collapse based on the card's own width, not the window's.**
  1.9.3's extra column step still measured the browser window, so a widget
  narrower than the full page (or a dashboard with UI scale turned up) kept
  4 tiles across long after they'd become uncomfortably narrow, and each step
  arrived too late. Applications, bookmarks, and favorites grids now drop a
  column exactly when their own card would squeeze tiles below a comfortable
  width — whatever the widget's span, window size, or UI scale, and live as
  you resize a widget in the layout editor. (#145)

- **Selecting an application's URL no longer starts a drag.** In the admin
  applications list, dragging across a row's text with the mouse now selects
  it as expected; reordering happens only from the ⠿ grip. (#127)

## [1.9.3] - 2026-07-10

### Added

- **The site's default font can be set from the admin.** Settings → General →
  Appearance gains a Default font select — all 12 faces, each shown in its own
  typeface — plus a Light mode font for giving a separate light look its own
  face, mirroring how the light design and scene diverge. Previously the only
  way to change the font every visitor starts with was editing `font:` in
  `config.yaml` by hand. (#123)

- **Saved themes can now be updated, renamed, and moved between browsers.**
  Saving a look under a name you've already used offers to update that theme in
  place instead of quietly adding a second copy with the same name. Each saved
  theme has a pencil button to rename it without re-saving. And a new Export
  button downloads your saved themes as a file that an Import button on another
  browser (or after clearing this one) reads back in — duplicates are skipped,
  so re-importing the same file is safe. (#124)

### Fixed

- **Settings and theme-builder polish.** On a phone, the theme builder's tab
  row now fades out at an edge with more tabs to scroll to, so it's clear the
  row keeps going. The Appearance mode and Units toggles announce their active
  choice to screen readers instead of showing it by color alone. "Reset all
  settings" now says up front that your saved themes and favorites survive it.
  And a greeting name typed with stray spaces around it no longer keeps them.
  (#125)

- **Card grids no longer jump from 4 columns straight to 2.** Shrinking the
  window with a 4-across Applications (or bookmarks/favorites) widget now
  passes through a 3-column step on the way down, and 3-across grids reach
  their third column one breakpoint sooner. Columns collapse one at a time.
  (#138)

### Removed

- **The live "now" dot at the end of each heartbeat strip.** However it was
  drawn, a live marker inside the timeline read as part of the history it
  wasn't part of. The strip now shows history only; whether a service is down
  *right now* still shows three ways on the same row — the status dot, the
  red "Unreachable for …" detail, and the row's red tint. (#141)

## [1.9.2] - 2026-07-09

### Added

- **Announcements on the status page.** Tell your household about a maintenance
  window or an upcoming change right where they check whether things are up — a
  dedicated section at the top of `/status`, separate from the site-wide banner.
  Each notice takes a kind (maintenance, incident, or a general notice) that
  tints its card, a title, and a message in the same inline markdown. Give one
  an optional start and end and it schedules itself: it waits as "scheduled"
  until its window opens, shows while it's on, and disappears on its own once
  the end passes — all in each visitor's own time zone. The section shows even
  when status checks are turned off. Add them under Settings → Monitoring →
  Announcements. (#118)

- **The status page timeline is now reachable with a keyboard and a screen
  reader.** Each uptime heartbeat strip reads as a single control: it announces
  a spoken summary ("24h uptime timeline: 91.7% up, worst Jul 7, 5:54 – 6:42 PM
  at 0% up, currently up"), takes keyboard focus, and steps through its buckets
  with the arrow keys (Home/End jump to the ends) — the focused bucket shows a
  marker and its exact reading appears beside the strip. Tapping a bar on a
  touchscreen does the same, so the per-bucket detail is no longer a
  mouse-hover-only feature. (#116)

### Changed

- **The status page's figures column and live "now" marker are easier on the
  eyes.** 1.9.1 stacked up to four lines beside each service; the uptime %
  and its average latency now share one line ("100.0% · avg 22 ms"), so a
  healthy service reads as two. And the live marker at the end of each
  heartbeat strip is a small centered dot instead of another full-height
  pill — it no longer passes for a 31st history bar, and its outage pulse is
  a good deal calmer. A long outage's "Unreachable for 11h 23m" now wraps
  onto a second line instead of being cut off mid-number. All the underlying
  data is unchanged. (#137)

### Deprecated

- **The status history API's unused `d7` (7-day) fields.** The
  `/api/status/history` payload still carries a 7-day uptime and latency
  window that nothing in the app displays. They stay for now so existing
  integrations keep working, but they are deprecated and will be removed
  in 2.0.0. (#117)

### Fixed

- **Status indicators now respect reduced-motion and announce which range is
  selected.** The pulsing status dots — on the dashboard, the header status row,
  and every service on the status page — hold still for visitors who ask their
  system for reduced motion, keeping their solid up/down color. The status
  page's range toggle (1h/24h/30d/90d) and the admin interval and default-range
  toggles now tell a screen reader which option is active, instead of signaling
  it by color alone. (#116)
- **TCP and ping checks now work for apps with an IPv6-literal URL.** An app
  configured as `http://[::1]:8096` reported down for TCP and ICMP checks —
  the brackets URLs use to write an IPv6 address were being passed straight
  through to the connection/ping call, which doesn't understand them. Both
  check types now strip the brackets and reach the address correctly. (#136)
- **Status tooltips and timings now read honestly.** An offline app's dot now
  shows the HTTP code it saw ("Offline · HTTP 404") instead of a bare
  "Offline"; the status page's "Updated" line grows past minutes into hours
  and days ("2h ago", "3d ago") rather than "1440m ago"; and on the 24h and 1h
  views each timeline bar's tooltip labels the time range it covers ("Jul 7,
  5:54 – 6:42 PM") instead of a single instant, so a dip can be pinned to a
  real window. (#117)
- **The uptime check interval always shows the value it's set to.** A
  hand-edited interval that matched none of the 1/5/15-minute presets left the
  control looking like nothing was selected; it now surfaces the actual value
  (e.g. "30 min") as its own selected chip. (#117)
- **Failed status-history recording is now logged.** When the background poller
  can't read its config or write the history file, it leaves a warning in the
  server log instead of failing silently, so a stalled uptime history is
  traceable. (#117)

## [1.9.1] - 2026-07-08

### Added

- **Alert channels can be tested with one click.** A "Send test alert" button
  in Settings → Monitoring pushes a test notification through the real
  webhook and email delivery paths and reports each channel's outcome
  separately — so a typo'd webhook URL or a wrong SMTP port shows up now,
  not during your next outage. (#111)
- **The status page now tracks response times.** Every check's round-trip
  time is recorded into the uptime history: each service shows its average
  latency for the selected range next to the uptime %, and the timeline
  bars carry per-bucket averages in their tooltips — a service that's up
  but getting slower is visible before it breaks. Existing history files
  carry over untouched (they just have no latency until now). (#115)
- **Uptime percentages now say how much data backs them.** When a service's
  recorded history covers materially less than the selected range — a
  freshly added app showing "100.0%" over 90 days — a small "since Jul 4"
  note under the figure says how far back the data really goes. (#112)
- **Active outages are now visible at a glance.** Down services say how long
  they've been down ("Unreachable for 23m", with the exact start time on
  hover) — and it survives server restarts. Every heartbeat strip also ends
  in a live "now" pill fed by the latest check, pulsing red during an
  outage, so "down right now" shows at every time range even when a long
  range's averaging would wash a fresh outage green. (#113)

### Changed

- **The DNS check now tests the server, not just the name.** A DNS check
  sends a real query to the app's host and counts it up when it answers —
  "is my Pi-hole actually resolving?" — instead of only checking that the
  host's own name resolves somewhere. Resolvers on a nonstandard port get a
  Port field in the app form. (#114)

### Fixed

- **Servers that mishandle HEAD requests no longer read as down.** Status
  checks retry with a full GET when a server rejects the lightweight HEAD
  probe (a 400/403 answer, a dropped connection, …), so services that work
  fine in a browser stop showing false outages. (#114)

## [1.9.0] - 2026-07-08

### Added

- **The layout editor can undo mistakes and start over.** Ctrl+Z (or the new
  Undo button in the edit toolbar) takes back your last change one step at a
  time — a mis-drag no longer forces a full Revert — and a new Reset button
  restores the stock arrangement, UI scale and card spacing (after asking
  first), so a regretted layout is never permanent. (#101)
- **The space above the first row of widgets is now adjustable.** A "Top gap"
  stepper in the edit toolbar tunes the air between the top of the page and
  the first widget (0–160px) — dense dashboards no longer have to live with
  the fixed padding. The default matches the old spacing exactly, so existing
  dashboards don't shift, and small screens cap the value at the old 48px so
  a roomy desktop setting doesn't waste phone space. (#106)

### Fixed

- **A sized header card no longer clips its status row on phones.** An
  explicit card height is tuned against the desktop layout; below the
  large-screen breakpoint the header card's contents stack taller and the
  fixed height silently cropped the status row (a sized greeting could clip
  the same way). Heights now apply on large screens only for cards that
  center their content — scrolling widgets (notes, feeds, lists) keep their
  height everywhere, since they scroll instead of clipping. (#105)
- **The header card now degrades gracefully as its pieces are toggled off.**
  With weather (or the clock) disabled, the lone remaining block used to hug
  the left edge with a slab of dead space beside it; it now centers. With
  only status checks left, the card renders as the proper standalone status
  pill instead of a bare sliver. The layout editor's tray also points out
  the separate Clock, Weather and Status widgets as an alternative to the
  combined card. (#105)
- **The layout editor's controls now work for touch and keyboard, not just a
  mouse.** The −/+ steppers auto-repeat while held, so walking a width across
  the grid or a height through its range no longer takes dozens of taps. The
  resize handles are real sliders: focusable, arrow-key operable (Home/End
  jump the range, Delete returns a height to Auto) instead of carrying a
  slider role they didn't honor. On touch screens the move arrows, steppers
  and resize handles grow to comfortable target sizes — the move buttons are
  the only way to reorder by touch and were barely 16px tall. The editor's
  tiny labels and badges also got a contrast bump. (#102)

### Changed

- **The edit toolbar's steppers now carry labels.** "Scale", "Card gap" and
  "Top gap" are written right on the controls instead of hiding in hover
  tooltips that touch screens never see. (#104, #106)
- **Layout editor paper cuts smoothed over.** Dragging a card over a
  full-width card now shows the insertion bar above or below it, instead of a
  vertical bar that wrongly promised a side-by-side insert. The Fill button
  no longer pops in and out while you drag-resize, and narrow cards tuck
  their height stepper into the More menu, so the control strip stops
  reflowing mid-gesture. The move arrows now say — and on large screens
  show — "earlier/later" (◀ ▶) to match how side-by-side cards actually
  move. The width stepper explains itself in plain words ("8 of 24 columns")
  and is dimmed on screens where widths don't apply. And Escape closes an
  open More menu, then exits edit mode just like Done. (#104)

## [1.8.5] - 2026-07-08

### Added

- **Set your weather location by searching for a city.** The Preferences card
  now has a city search next to "Use my location", so you can pick any city
  by name — the only way to personalize weather on plain-HTTP installs, where
  device geolocation isn't available (the error message even said to "set it
  manually", but there was no way to). A Reset button returns to the site
  default once you've set your own. (#122)

### Fixed

- **Destructive settings actions now ask first.** "Reset all settings",
  "Reset theme", deleting a saved theme, and resetting an edited theme in the
  admin portal all fired instantly with no way back — one stray click could
  discard a look you'd just spent time building. Each now shows a
  confirmation. The delete button on saved themes is also visible all the
  time instead of only on hover, so themes can finally be deleted on phones
  and tablets. (#121)
- **The layout editor now shows the page as visitors will see it.** Hidden and
  empty widgets used to occupy full-size cells while editing, so the editor's
  rows never matched the live page (on a fresh install the edit view was more
  than twice the page's real height). They now collapse into a "Not on the
  live page" tray below the grid — hidden widgets can be shown from there to
  place them, and empty ones say what would give them content — so the grid
  you arrange is exactly the grid visitors get. (#98)
- **Dragging a card no longer smears a text selection.** In the layout editor,
  grabbing a card's body used to sweep a blue selection across its labels and
  content instead of doing anything useful. Text selection is off while
  editing, and a card can now be dragged by its whole title row — not just the
  small ⠿ grip, which also got easier to see. (#99)
- **The per-card More menu closes like every other menu.** It now closes when
  you click anywhere else or press Escape, instead of staying open until you
  clicked its own button again — so menus no longer pile up and cover the
  card next door. (#100)
- **Service names no longer get cut off on phones.** The status page reserved
  a fixed-width column for the uptime figures at every screen size, squeezing
  names on small screens down to stubs like "Home A…". On phones the figures
  now sit beside the heartbeat strip on its own line and the name gets the
  full width; desktop keeps the aligned columns. (#110)
- **The status page's 1h view no longer shows false gaps.** With the default
  5-minute check interval the hourly timeline used to render an alternating
  comb of filled and empty pills that looked like flapping. Each check now
  counts until the next one runs, so the strip reads continuously at any
  interval — while a genuinely stalled poller still shows a gap. (#108)

## [1.8.4] - 2026-07-07

### Fixed

- **Edits made just before leaving a page are no longer lost.** Autosaved
  forms (the admin settings, theme overrides, and the layout editor) wait a
  moment before writing. Making a change and immediately navigating away —
  or closing the tab — used to drop that last edit silently, sometimes while
  the status still read "Saving…". The pending change is now saved on the way
  out. (#103)
- **Applying a saved theme now switches everything at once.** Clicking a saved
  theme applied its colors immediately but kept the previous design, scene
  styling, and font until you toggled the appearance mode or reloaded the
  page. The design, scene, and font now switch the moment the theme is
  applied. (#120)
- **Saving a theme now works on plain-HTTP deployments.** On a server reached
  over plain HTTP (a NAS or home-lab IP, the common self-hosted setup), the
  theme builder's Save button silently did nothing — the id generator it used
  only exists on HTTPS/localhost. Saving now works everywhere, and if the
  browser genuinely can't persist the theme (blocked storage, private mode),
  the builder says so instead of staying silent. (#119)
- **Deleting an app or bookmark now reports failure honestly.** When a delete
  failed (server error, dropped connection, or a session signed out elsewhere),
  the admin page still removed the row and said "deleted" — and the item
  quietly reappeared on the next reload. The row now stays put and the actual
  error is shown, matching how saving and reordering already behave. (#126)
- **Keyword status checks no longer buffer huge responses.** A keyword check
  pointed at a very large response (say, a download link instead of a landing
  page) used to load the entire body into memory on every poll. Bodies are now
  capped at 2 MB, and a page whose keyword can't be verified within the cap
  counts as down. (#109)

## [1.8.3] - 2026-07-03

### Changed

- **Server-side logging.** Failures that used to be silent — a timed-out or
  unreachable weather/RSS/calendar fetch, a rejected or undelivered alert — are
  now logged to the container's output so problems are easier to trace. Set the
  verbosity with the `LOG_LEVEL` environment variable (`debug`, `info`, `warn`,
  `error`; default `info`). (#97)

### Fixed

- **The page no longer hangs when weather is slow.** Weather requests are now
  time-boxed, and the home page fetches weather, the calendar, and the RSS feed
  at the same time instead of one after another — so an unresponsive weather
  service can't stall the whole page. The weather widget just fills in once it's
  reachable. (#96)

## [1.8.2] - 2026-07-03

### Changed

- **More room on large screens.** The page now uses up to 1440px of width
  (was 1280px), so the dashboard and every other page make better use of a big
  display while staying centered. Tablet and mobile layouts are unchanged. (#94)
- **Tidier admin Settings.** The Settings sections are grouped into fewer entries
  (Appearance folds into General, the content widgets share one Widgets section,
  and Status + Alerts share Monitoring), and each section now fills the width
  instead of sitting in a narrow column with empty space beside it. (#95)

### Fixed

- **The status heartbeats now line up across every service.** Each service's
  uptime strip starts and ends in the same place regardless of how wide its
  uptime figure or status text is, and the pills have a touch more space between
  them so the strip reads less crammed. (#93)

## [1.8.1] - 2026-07-03

### Fixed

- **The layout editor now shows exactly what the live page will look like.**
  Cards pack up their columns while you arrange them — the same way they do on
  the live page — and they stay in the order you place them instead of
  reshuffling as you make small changes. No more tuning the layout and getting a
  different result after you hit Done. (#92)
- **Space a card on any side, not just below.** The per-card spacing control now
  adds room above, below, or beside a card (for cards that share a row), so you
  can separate sections in the direction you actually need. Spacing you set in an
  earlier version is kept as space below the card. (#92)

### Changed

- **Resize cards by dragging their edges.** Drag a card's right edge to set its
  width and its bottom edge to set its height, right on the dashboard — the
  steppers are still there for precise, keyboard-friendly adjustments. The
  less-used controls (per-side spacing, cards-per-row, heading on/off) now live
  behind a tidy **More** menu on each card, so the editor is far less cluttered.
  (#92)

## [1.8.0] - 2026-07-03

### Added

- **Set any card's height.** The layout editor's height control now sets how
  tall a card actually is — on every widget, not just the content cards. Make a
  card taller than its content to give it presence (the greeting and header card
  center in it), or shorter so a long list scrolls inside. (#90)
- **Control the spacing.** A spacing stepper in the edit toolbar sets the
  vertical gap between all cards, and a per-widget space-below stepper adds extra
  padding beneath a specific card — so you can space the dashboard the way you
  want. (#90)
- **Bolder status heartbeat.** The uptime timeline now draws 30 wider pills per
  range instead of 60, filling the same strip — easier to read at a glance. (#91)

### Fixed

- **The header follows its old layout again.** After the vertical-packing change
  in 1.7.0 the greeting was pinned to the top instead of centering beside the
  header card. Giving the header widgets a height now centers their content, and
  the packing respects the new height and spacing controls. (#90)

## [1.7.0] - 2026-07-03

### Added

- **Announcement banner.** A purpose-built banner across the top of every page
  for notices, maintenance windows, or a heads-up for the household — turn it on
  in admin Settings → Announcement, write the message (safe inline **bold**,
  *italic* and [links](https://…)), pick a tone (info, warning, success, or your
  accent), and optionally let visitors dismiss it (it returns when you change
  the message). No more repurposing the Notes card. (#89)
- **Fill dead space in the layout editor.** When a widget doesn't reach the end
  of its row, a **Fill** button widens it to close the gap — and any space still
  left over is now backfilled automatically by the next card that fits, so
  partial rows no longer strand empty columns. (#86)
- **Per-widget section-label toggle.** Each titled section (Applications,
  Bookmarks, Favorites, Calendar, Notes, RSS feed, Countdown) gains a
  **Label on/off** control in the layout editor to hide its heading while
  keeping the card itself. (#86)
- **Cards pack up the columns.** The dashboard now packs vertically like a
  masonry board — a short card rises into the empty space beside a taller
  neighbour instead of leaving a ragged gap — so mixed-width layouts stay tight.
  (#87)
- **Per-widget height cap.** Content cards (Applications, Bookmarks, Favorites,
  Calendar, Notes, RSS feed, Countdown) take a max-height control in the layout
  editor, so a long list becomes a compact card that scrolls inside instead of
  running the full length of its content — pair it with the width to size a
  widget into any rectangle. (#88)

### Changed

- **Consistent status timeline.** The uptime heartbeat now sits inline in each
  service's row (beside the uptime figure) and draws the same number of
  equally-sized pills for every range, so the strip keeps its size when you
  switch between 1h, 24h, 30d and 90d — only the data underneath changes,
  instead of the bar stretching or shrinking per range. (#85)

## [1.6.0] - 2026-07-02

### Added

- **A Countdown widget.** Labeled dates shown as "in N days" rows — domain
  renewals, birthdays, deadlines — managed in admin Settings → Countdown.
  Days count in each visitor's own time zone; today and tomorrow get an
  accent chip, past dates dim and sink below upcoming ones. Ships hidden.
  (#79)
- **An RSS feed widget.** Show the latest headlines from any RSS or Atom feed
  on the home page. Configure the URL and entry count in admin Settings → RSS
  feed (with a Test feed button), and show the card from the layout editor.
  Entries are fetched server-side and cached for a few minutes; only safe
  http(s) links are rendered. Ships hidden. (#79)
- **A Notes widget.** A free-form card for the home page — reminders, runbook
  snippets, a message for the household — written in admin Settings → Notes
  using a safe markdown subset (headings, bold/italic, links, lists, quotes,
  code blocks). Raw HTML is displayed as text, never rendered. Ships hidden;
  show it from the home-page layout editor. (#79)
- **Living weather hero.** The weather page's hero now plays a subtle
  animated effect matching the current conditions — falling rain or snow,
  storm flashes of lightning, rolling fog, drifting clouds, a warm sun glow
  by day or twinkling stars at night. Effects respect the reduced-motion
  preference by rendering a single still frame.

### Changed

- **Consistent status heartbeat pills.** The uptime timeline on the status
  page now draws the same slim rounded pill for every time range, anchored to
  the right edge so "now" stays put when switching ranges — instead of bars
  stretching into wide blocks on the shorter ranges.

## [1.5.0] - 2026-07-02

### Added

- **A Stone palette.** A fairly neutral warm-gray palette — greige surfaces
  with muted stone accents — joins Mono at the neutral end of the preset row
  (21 palettes in all).
- **Six new designs.** Aura (borderless, haloed in accent glow), Emboss
  (soft-raised from the page), Carve (recessed, pressed into the page), Stripe
  (crisp card with an accent top bar), Sketch (hand-drawn dashed outlines) and
  Console (terminal panel with an accent edge) — 18 designs in all.
- **Two new scenes.** Petals (cherry-blossom petals adrift on the breeze) and
  Comets (shooting stars with fading trails) — 18 scenes in all. The Bloom
  theme now drifts Petals through its rose-and-violet look instead of Nebula.
- **Six new fonts.** Outfit, Space Grotesk, Manrope, Rubik, Playfair Display
  and Quicksand — 12 typefaces in all.

### Changed

- **Light and dark accents are now independent.** The accent gradient set in
  the theme builder applies only to the mode being edited, so each mode can
  carry its own accent. An accent saved before this release keeps applying to
  both modes until changed.
- **Buttons now follow the active design's personality.** Button corner
  rounding is its own design token, separate from the card radius — square on
  Bold and Console, pills on Soft and Clay — instead of one fixed rounding
  everywhere. Existing designs also got small polish tweaks: a heavier Frost
  fill and sheen, and a richer Gradient accent wash.
- **The Admin portal is easier to reach and quieter to look at.** It's now in
  the floating navigation menu on every page, and the button on the Settings
  page uses the standard quiet button style instead of the loud accent fill,
  so it sits cohesively with the rest of the theme.
- **Backups now include your uploaded icons.** Export bundles the uploaded
  icon files into the single JSON backup and Import restores them, so a config
  moved to a new instance keeps its custom icons instead of showing broken
  images. Backups made before this release still import as before. (#72)

### Fixed

- **The admin tab row no longer overflows the page on phones.** At narrow
  widths the row scrolls within itself instead of forcing the whole page
  sideways and cutting off content. (#74)
- **The Settings page no longer throws a hydration error.** The time-zone
  suggestion list is now filled in after load — the server's and the
  browser's time-zone databases can differ, so rendering it server-side
  guaranteed a mismatch that made React re-render the page. (#84)

## [1.4.1] - 2026-07-02

### Changed

- **The theme builder was redesigned around tabs.** Themes, Colors, Design,
  Scene and Font each get their own tab instead of one long stack of grids,
  with the light/dark Editing switch always visible in the header and the
  save/reset actions in a footer. The colors tab now makes the moving parts
  clear: palette swatches show their dark and light halves (picking one
  recolors both modes), the surface pickers are labelled as editing only the
  current mode, and the accent is edited on the gradient itself — a bar with
  a color well at each end, plus a Solid toggle for single-color accents.

## [1.4.0] - 2026-07-02

### Added

- **Seven new scenes.** Horizon (a retro sun sinking to a glowing horizon),
  Orbit (orbital rings with wandering planets), Peaks (layered mountain
  ridgelines), Rain (gentle falling accent streaks), Fireflies (wandering,
  softly pulsing lights), Blueprint (drafting-paper grid with construction
  marks) and Prisms (drifting translucent geometric shards) — 16 scenes in
  all. (#80, #81)
- **Four new palettes.** Terracotta, Citrus, Everforest and Cobalt round the
  preset row out to 20. (#82)

### Changed

- **Palette presets now apply to both modes at once.** A palette is a cohesive
  light + dark pair; picking one used to restyle only the mode being edited
  (while still changing the shared accent), leaving the other mode a mismatch
  of two palettes. Swatches now show the full palette — surface, ink and
  accent — instead of just the accent gradient. (#82)
- **The Glow, Vortex and Mesh scenes were retired** (all three were soft
  gradient washes that Aurora and Nebula already cover). Saved references —
  visitor choices, admin defaults, theme-pack overrides — fall back to Aurora;
  the Daybreak, Singularity and Frostbite packs re-point to Horizon, Orbit and
  Peaks. (#80)

### Fixed

- **The Save (theme builder) and Admin portal (settings) buttons** now use the
  app's canonical button recipe instead of one-off styles, and the decorative
  arrow is gone from the Admin portal link. (#83)
- A stored admin default theme referencing a retired design/scene id now
  coerces to the default instead of failing the whole config load. (#80)

- **Cards-per-row control for the Applications, Bookmarks and Favorites
  widgets.** Each gets a second stepper in the layout editor that forces how
  many cards sit side by side (1–4) instead of the automatic span-derived
  split; an **Auto** button returns to the old behavior. Overrides still
  collapse responsively on small screens. (#75)
- **A site-wide UI scale.** A stepper in the layout editor's toolbar (70–150%,
  in 5% steps) resizes every element uniformly — text, paddings, cards — with
  live feedback while editing. Rendered server-side, so pages load at the saved
  scale with no flash. (#76)

### Changed

- **The widget grid doubles from 12 to 24 columns** for finer widget sizing.
  Saved layouts migrate automatically on their next load/save (spans double
  onto the new grid; a `columns` marker in the stored layout keeps the
  migration one-shot), and pre-1.3 `width` layouts still load too. (#77)
- **The clock/weather/status cards now adapt to their grid cell.** The
  combined header card (and the standalone clock/weather widgets) fill their
  cell, so resizing them in the editor is actually visible; the time/weather
  row sits side by side when the cell is wide and stacks vertically when it's
  narrow, instead of clipping. (#78)

## [1.3.0] - 2026-07-01

### Added

- **A drag-and-drop home-page layout editor.** Signed-in admins get an **Edit
  layout** entry in the floating corner menu (or the **Arrange the home page**
  link in admin Settings → Layout) that turns the home page itself into the
  editor: drag widgets to reorder, resize them with a 1–12 column stepper, and
  show or hide anything in place. Changes autosave, **Revert** restores the
  arrangement you entered with, and every control is a real button, so the
  editor is keyboard- and touch-friendly — mouse drag is just a shortcut.
- **A 12-column widget grid.** The dashboard grid doubles from 6 to 12 columns
  for much finer widget sizing; rows still pack automatically with
  content-driven heights.
- **The header is now widgets.** The greeting and the clock/weather/status
  card are placeable like everything else — and the combined card can be
  swapped for separate **clock**, **weather**, and **status** widgets (hidden
  by default) for a fully custom top row.

### Changed

- **The admin Settings tab was redesigned around a section nav rail** (a
  sticky list on desktop, wrapping pills on mobile) showing one focused
  section at a time, with the old "Dashboard" grab-bag split into proper
  Search and Status sections.
- **Admin Settings → Layout → Arrangement moved to the home page.** The
  settings list is replaced by a link to the on-page editor; the visibility
  checkboxes remain and now drive the same per-widget `hidden` flags the
  editor uses.
- Saved layouts from earlier versions (`width: full|twoThirds|half|third`)
  still load, render identically, and migrate to the new `span` shape on the
  next save; old config exports import cleanly. On tablet widths (below the
  large breakpoint) the greeting and header card now stack vertically — the
  grid packs side-by-side from the large breakpoint up.

## [1.2.2] - 2026-07-01

### Added

- **Two-thirds and one-third section widths.** Admin **Settings → Layout →
  Arrangement** now offers two-thirds and one-third widths alongside full and
  half, so up to three dashboard sections can share a row (for example
  Applications at two-thirds beside Bookmarks at one-third).

### Changed

- **The Help page is now full-width**, matching the other pages, with a
  three-column card layout on wide screens. Its copy was also tightened and
  reworked for easier reading.
- **Applications and Favorites reflow to match their column width.** They show
  three cards across at full width and one per row once the column is half-width
  or narrower, the same way Bookmarks already stack.
- **The navigation menu labels the status page "Service Status"** for clarity;
  it continues to list only the pages for features the admin has enabled.
- **Accent buttons restyled.** Buttons that used the accent gradient now fill
  with the primary accent color and light up a secondary-accent border on hover,
  rather than showing a static two-color gradient.

## [1.2.1] - 2026-07-01

### Changed

- **Navigate from anywhere.** The floating corner button is now a menu linking to
  every enabled page — Dashboard, Weather, Status, Calendar, Help, Settings — so
  you can move between them without returning to the dashboard first, and the Help
  page is reachable from every page (not just Settings). The admin toggle is now
  labelled "Floating navigation menu".

### Fixed

- The home calendar widget now uses the same section title as the other widgets,
  so it no longer looks out of place when set to half-width.
- At half-width, the Bookmarks section shows one category per row instead of
  squeezing two into a narrow column.
- The **/calendar** month view now fills the page width instead of being capped
  to a narrow column.

## [1.2.0] - 2026-07-01

### Added

- **Arrange the home page.** Admin **Settings → Layout → Arrangement** now lets you
  reorder the dashboard sections (search, calendar, favorites, apps, bookmarks) and
  set each to full- or half-width — two half-width sections in a row sit side by
  side. Visibility toggles are unchanged, and the default arrangement matches the
  previous fixed layout.
- **A month view for the calendar.** The **/calendar** page now opens on a month
  grid, with a Month/Agenda switch to fall back to the upcoming-events list.
  Recurring events fill each day and everything shows in each visitor's own time
  zone, with prev/next month navigation. The home calendar widget can be switched
  from the agenda to a compact month calendar (that links through to the full
  page) via **admin Settings → Calendar → Home widget view**; the agenda stays
  the default there.

### Changed

- **The Help page is now a full guide.** What was a quick overview is now a
  comprehensive reference: visitor cards for search, `!bang` shortcuts,
  favorites, per-visitor preferences, the theme builder, the extra pages,
  privacy, and installing as a PWA — plus a much deeper **For admins** section
  covering apps/bookmarks/icons, the search engine and custom bangs, uptime
  monitoring, alerts, the calendar feed, home-page components, the themes
  editor, config backup, passwords, and deployment.

## [1.1.4] - 2026-07-01

### Security

- **The admin password is no longer part of config export/import.** Exporting a
  backup from the admin portal previously included the stored password hash and
  salt; it's now stripped from the download. Importing a config no longer
  changes the password either — the on-disk credential is always preserved, so
  restoring an older or hand-made backup can't silently wipe it and drop the
  instance to passwordless. Password changes still go only through the admin
  Change Password flow.
- **Hardened the pre-paint theme script against HTML injection.** The inline
  theme script now HTML-escapes the serialized theme, so a crafted theme
  `preset`/`presetLight` value (settable through the settings API or an imported
  backup) can't break out of the `<script>` tag and inject markup into the pages
  served to every visitor.

### Changed

- **/help gained a For-admins section.** The help page is now split into "For
  everyone" and "For admins", with a new **Deployment & security** card that
  documents running behind a reverse proxy and setting `TRUSTED_PROXY_HOPS=0`
  when the app is exposed directly, so a spoofed `X-Forwarded-For` can't slip
  past the per-IP login throttle. (#36)

## [1.1.3] - 2026-06-30

### Added

- **An in-app Help page.** A new **/help** page (alongside /weather, /status and
  /calendar) documents how to use ctrlcenter — search and keyboard shortcuts,
  `!bang` shortcuts (built-ins plus app-name/subtitle/custom bangs), pinning
  favorites, the extra pages, per-visitor personalization, and a pointer to the
  admin portal and README. Linked from **/settings** (reachable via the gear on
  every page). (#71)
- **Calendar: hide the home card when nothing's coming up.** A new **Hide when
  no upcoming events** toggle in the Calendar settings drops the home-page
  "Upcoming" card entirely when the agenda is empty (default off, so the
  always-visible empty state from 1.1.2 is unchanged). The /calendar page still
  shows its own empty state. (#68)
- **Search bangs now also match app subtitles.** Alongside the auto-generated
  `!appname` shortcuts, each app's subtitle becomes an alias (e.g. an app named
  "Jellyfin" with subtitle "Media" also answers to `!media`). App names always
  win a slug collision with another app's subtitle. (#70)

### Changed

- **The search bar sits above the calendar** on the home page — it's now the
  first thing under the header. The agenda card tucks in just below it and steps
  aside during an active search so results stay next to the input. (#69)
- **Admin Settings columns balance themselves.** The two-column layout now flows
  its cards into balancing masonry columns, so enabling or disabling any section
  keeps the columns roughly even instead of stranding one short. (#64)

## [1.1.2] - 2026-06-30

### Changed

- **The agenda is now discoverable.** A dedicated **/calendar** page (like
  /weather and /status) shows the full agenda; the home "Upcoming" card links to
  it and shows "No upcoming events" instead of vanishing when the feed is empty;
  and the admin Calendar settings gained a **Test feed** button that reports
  whether the feed is reachable and how many upcoming events it has. (#65)
- **Webhook and email alerts are independent channels.** The webhook now has its
  own enable toggle, symmetric with email, under the master Alerts switch — so
  email can be used on its own without configuring a webhook. (#61)
- **Alert emails are HTML-formatted** with a configurable **subject** template
  (`{service}` / `{status}` variables; blank uses the default). (#66)

### Security

- **Capped the calendar fetch response size** (5 MB) so a huge or malicious feed
  can't exhaust server memory — the fetch is reachable from anonymous page loads.
  (#67)
- Bounded sharp's decoded input pixels and squared output size on icon upload,
  added CR/LF sanitization to the templated email subject, and warn in the admin
  when a private calendar URL is plain http (credentials sent in cleartext). (#67)

## [1.1.1] - 2026-06-30

### Added

- **Private calendars (CalDAV/WebDAV).** The agenda can now read a password-
  protected calendar — paste a Nextcloud (or ownCloud/Radicale/Baikal) DAV
  calendar URL with an optional username + app-password. A bare collection URL is
  fetched via its `?export` ICS endpoint. The password can instead come from the
  `CTRLCENTER_CALDAV_PASS` env var. (#62)

### Changed

- **Webhook and email alerts are now clearly independent channels.** The Alerts
  settings present the webhook (optional — leave the URL blank to skip) and email
  (its own toggle) as separate channels under one master switch, so you can use
  email alone without configuring a webhook. (#61)
- **The floating settings button now appears on the weather and status pages**,
  not just the home page, so visitors can reach their settings from anywhere.
  (#63)

### Fixed

- **The header time/weather card no longer stretches across the page.** A 1.1.0
  change moved its class into a template literal, which made Tailwind drop the
  `sm:w-auto` rule, so the card fell back to full width; it's content-width again.
  (#59)
- **Uploaded icons keep their aspect ratio.** A non-square image (e.g. a wide
  wordmark used as the favicon) is now centered on a square transparent canvas on
  upload, so it isn't stretched in the browser tab or PWA. (#60)
- **The admin Settings columns are balanced again** — the Layout section moved to
  the left column, so the two columns are even rather than lopsided. (#64)

## [1.1.0] - 2026-06-30

### Added

- **Uptime alerts.** With service status checks on, the background poller can now
  notify you as a service goes **down** or **recovers** — to a **webhook**
  (generic JSON, Discord, Slack, or ntfy) and/or by **email** over SMTP (works
  with SMTP2GO, Gmail, Fastmail, or any relay; the password can come from a
  `CTRLCENTER_SMTP_PASS` env var so it stays out of the config file).
  Flap-dampening **confirmations** require a few consecutive failed checks before
  declaring an app down, and a restart won't re-alert one that was already down.
  Configure it under admin → Alerts. (#50, #56)
- **Search bangs.** Start a query with `!` to jump straight out: built-ins
  (`!gh`, `!yt`, `!w`, `!npm`, `!maps`, `!so`, `!g`, …), your own custom bangs
  (admin → Search), and an auto-bang for every app, so `!plex` opens Plex. An
  unrecognized bang falls back to a web search. (#51)
- **Favorites.** Pin your most-used apps to a Favorites row at the top of the
  dashboard. Per-visitor, stored in the browser, no account needed. (#52)
- **Agenda widget.** A new **Upcoming** card shows the next few events from any
  published iCal (`.ics`) URL — a Google Calendar secret address, Fastmail,
  Nextcloud, and the like. Recurring events (daily/weekly/monthly, honoring
  EXDATE cancellations and per-instance overrides) are expanded over the coming
  weeks, and times render in each visitor's own time zone. Configure it under
  admin → Calendar. (#53, #54, #55)
- **Show or hide home-page components.** A new admin **Layout** section toggles
  individual parts of the home page on or off — greeting, date/clock, search,
  applications, bookmarks, the favorites row, and the floating settings button —
  alongside the existing weather, status, and agenda toggles. (#57)

### Fixed

- **The favicon icon picker no longer hides behind other settings cards.** Its
  overlay was trapped in the General card's stacking context (a side effect of
  the card's `backdrop-filter`); it now renders through a portal so it sits above
  everything. (#58)

## [1.0.2] - 2026-06-30

### Changed

- **Scene backdrops read richer in light mode.** The accent-driven scenes
  (Aurora, Nebula, Rays, …) now deepen and saturate their colours on light
  surfaces — from the first paint, via the no-flash script — so they land as a
  colour burst instead of washing out. Dark mode is unchanged.
- **The secondary accent colour is now actually used.** The end colour of a
  two-tone accent gradient barely showed; it now colours the section labels
  (bookmark group headers, drawn as a from→to gradient) and adds a second layer
  to the card hover glow, so both accent colours read across the dashboard. (#47)
- **One consistent "Back to dashboard" control on every page.** Settings,
  weather, status, and admin shared differently-worded back links and the admin
  login had none; they now use the same control, and the login screen finally has
  a way home. (#46)

### Fixed

- **A favicon set in the admin portal now takes effect.** The bundled default
  icon (a Next.js file-convention icon) overrode the configured one before it
  reached the browser tab; the default is now only a fallback, so your favicon
  shows. (#48)
- **Accent-gradient buttons keep legible text in any theme.** Buttons like the
  **Admin portal** one used a fixed black label that could turn unreadable on a
  dark accent; the text colour is now derived from the accent's brightness and
  works in both light and dark mode. (#45)

## [1.0.1] - 2026-06-26

### Changed

- The status page rows now show each app's **subtitle** next to its host (e.g.
  `Nextcloud · files.example.com`), matching how apps read in the admin
  ordering cards; rows with no subtitle still show just the host.
- In the theme builder, switching the light/dark **Editing** toggle now previews
  that mode live so you can see the edits you're making. The preview is
  temporary — it never changes your saved Appearance mode and reverts when you
  leave the page — and the toggle always starts on the mode currently on screen.

### Fixed

- The admin **Settings** tab's two columns no longer leave dead space between
  their cards; each column now stacks its cards flush from the top.

## [1.0.0] - 2026-06-26

### Added

- The home page header now surfaces the **status page**: a health row (e.g.
  `All systems operational`) sits beneath the time/weather row inside the same
  header card and links to `/status`, so it's reachable from the top of the page
  instead of only via a pill tucked beside the Applications heading. The header
  keeps its width, and a single poller backs both this row and the per-app dots.
- The theme builder's light/dark **Editing** toggle now switches the whole theme,
  not just the palette. Light and dark are independent looks — each with its own
  design, scene, font, and colors — so you can run, say, a Cyber/Grid dark theme
  alongside a Paper/Waves light theme. Tapping a preset fills only the mode you're
  editing, and saved themes capture both modes.
- The admin **Settings → Appearance** section gained a **Light mode look** picker,
  letting the site-wide default use a wholly different design/scene/colors in
  light mode (leave it on _Same as default_ to mirror the dark default).

### Changed

- The Reset all settings button on the visitor settings panel now matches the
  height of the Units toggle on the same row.
- The two columns in the admin **Settings** tab now render at equal height, so
  their tops and bottoms line up.

### Fixed

- The add/edit form on the admin Applications and Bookmarks tabs now lines up
  with the top of the list instead of sitting slightly lower.
- The status page uptime timeline now reads in your time zone instead of UTC —
  both the displayed times and the daily-bar boundaries align to your local
  calendar day.
- Drag-to-reorder in the admin now shows an insertion line that points to exactly
  where the row will land, instead of a whole-row highlight that read as
  off-by-one.
- Changing the admin **default theme** now applies fully. Previously its surface
  colors were ignored for any visitor who had used the light/dark toggle (only
  the design, scene, and accent changed); the default theme's colors now apply
  regardless of mode choice.
- An invalid time zone (a hand-edited config value or stale per-visitor
  preference) no longer crashes the dashboard. The date/time helpers fall back
  to UTC instead of throwing, and invalid stored zones are dropped.
- A single malformed app/bookmark/theme entry in a hand-edited `config.yaml` no
  longer takes down every page — the offending row is skipped on load while the
  rest of the config still applies. Importing a config file is still validated
  strictly.
- Native controls, scrollbars, and `<select>` dropdown lists now match the
  active light/dark theme instead of rendering light-on-light.
- The header weather widget no longer shows `NaN°` when the weather API omits a
  field.
- Admin Settings autosave no longer risks persisting a stale value when a save
  is slower than the next edit.
- Config writes are now atomic (temp file + rename), so a concurrent read can
  never see a half-written file.
- Cleared the React hydration warning (#418) logged on load from the no-flash
  theme script.

### Security

- Documented that `TRUSTED_PROXY_HOPS` must be set to `0` for directly-exposed
  deployments, otherwise a spoofed `X-Forwarded-For` can evade the per-IP login
  throttle.

## [0.9.9] - 2026-06-25

### Added

- **Custom icon upload.** The admin icon picker now has an **Upload image**
  button (PNG, JPEG, WebP, GIF, SVG, ICO). Uploaded icons are stored beside
  `config.yaml` (in `uploads/`) and served by the app, and appear under **Your
  icons** for reuse. Icon fields also accept a `data:` URI.
- **More uptime check methods.** Besides HTTP, an app can now be monitored by
  **TCP port**, a **keyword** in the response body, **DNS** resolution, or
  **ICMP ping**. ICMP needs the `NET_RAW` capability in containers (see
  `docker-compose.yml`); the others work anywhere.
- **Font picker** in the theme builder — Plus Jakarta Sans (default), Inter,
  Poppins, Nunito, Lora, and JetBrains Mono.
- Four new **themes** (Frostbite, Halftone, Singularity, Daybreak), four new
  **designs** (Frost, Outline, Paper, Gradient), and four new **scenes** (Dots,
  Glow, Vortex, Mesh).

### Changed

- **Settings:** "Reset all settings" now sits in the preferences grid in line
  with Units, instead of hanging off the bottom.
- **Admin Settings:** the Security (password) section moved to the first column
  so the two columns are more balanced.
- The dashboard greeting is slightly smaller.

### Removed

- The bundled automotive sample icons (`rockauto`, `car`, `tire`,
  `car-battery`, `steering-wheel`) — superseded by custom icon upload.

## [0.9.8] - 2026-06-24

### Added

- The **default uptime range** (1h / 24h / 30d / 90d) the status page opens on is
  now configurable in admin settings.

### Changed

- **Admin Settings and Themes now autosave** as you edit (no more Save button),
  matching Applications/Bookmarks. The password reset moved into the settings
  card grid instead of hanging off the bottom.
- **Uptime bars** use a finer colour scale: green ≥95%, amber 75–95%, a new
  darker orange 50–75%, red below 50%.
- The **Admin portal** is now a prominent button in the settings header.
- The theme builder's **Editing (dark/light)** toggle defaults to the mode the
  app is currently set to.
- The search box placeholder is just **"Search"**, and the `/` badge was removed
  (the keyboard shortcut still works).

## [0.9.7] - 2026-06-24

### Added

- **Traces** scene — a motherboard / circuit-board backdrop with signal pulses
  travelling along the traces (used by the Circuit theme).

### Changed

- The light/dark/system **mode selector moved to Preferences**; the theme builder
  now has its own "Editing: dark / light" toggle so both modes can be designed
  independently of what the app is currently showing.
- **Wider pages** — all pages grew from 1152px to 1280px.
- **Starfield** now mixes a dense star field with a few linked constellations
  (the old Constellation scene folded into it).

### Removed

- The "oldest left, now right…" caption under the uptime bars.
- The standalone Constellation scene (merged into Starfield).

## [0.9.6] - 2026-06-24

### Fixed

- Uptime bars no longer show a stray segment at the opposite end after switching
  from the 1h view to 24h / 30d / 90d (a duplicate-key rendering bug).

### Changed

- Admin **Settings → Appearance** is now a simple **Default mode + Default theme**
  picker instead of duplicating the Themes editor's design/scene/colour controls.
- The admin **Themes** editor shows an accent gradient preview, not just the
  start/end colour pickers.
- The uptime monitor drops the **7-day** range (now 1h / 24h / 30d / 90d) and
  renders periods with no data as clearly empty, with an "oldest left, now right"
  note so gaps don't look out of order.

## [0.9.5] - 2026-06-24

### Added

- **Rename the built-in themes** from the admin Themes tab (alongside recoloring
  and changing their design/scene).
- A **Visibility** tile on the weather page, which also evens out the stat grid.

### Changed

- The theme builder's **palette swatches** show the accent gradient on its own
  again (clearer than washing it over the background).
- The admin **Settings** page is reorganized into a tidy two-column layout of
  section cards, with the password reset grouped as a Security card.

## [0.9.4] - 2026-06-23

### Changed

- **Scenes are now visible in light mode** — Aurora, Nebula, Rays, Starfield and
  Constellation were washed out on light surfaces and now read clearly.
- **More distinct backdrops:** replaced Mesh with **Rays** (sweeping beams of
  accent light) and redesigned **Nebula** into a denser, textured cloudbank, so
  it no longer looks like Aurora.
- **Rebalanced the 16 palettes** to span the colour wheel instead of clustering
  on purple/blue (added Mono, Crimson, Indigo; retuned others).
- **Redesigned the Bloom theme**, light mode first.
- **Theme builder clarity:** the colour pickers are now grouped under a
  **Palette** section ("Customize (this mode)"), making clear they build the
  palette and the accent is just its gradient. Theme and scene preview swatches
  now follow the active light/dark mode.

## [0.9.3] - 2026-06-23

### Added

- **Admin theme editor.** A new **Themes** tab in the admin portal lets you edit
  the built-in themes — recolor them and change their design and scene — applied
  site-wide, with a reset-to-default on each.
- **Bigger theming catalog:** now **8 designs** (new: Clay), **8 scenes** (new:
  Mesh, Constellation), **16 palettes** (added Dracula, Solarized, Gruvbox,
  Catppuccin, Tokyo, Monokai, Grape, Aqua), and **8 themes** (added Bloom,
  Lagoon, Circuit).

## [0.9.2] - 2026-06-23

### Added

- **1h range** on the status timeline, showing each individual poll as its own
  bar (kept in a short ring of raw readings alongside the hourly buckets) plus a
  matching 1h uptime figure.

### Changed

- The status timeline now defaults to the **24h** view (was 90d).
- Timeline bars have **rounded edges** for a cleaner look at every range.

## [0.9.1] - 2026-06-23

### Fixed

- **Uptime history now accrues and shows recent activity.** The history store is
  shared correctly between the background poller and the page (it could freeze on
  the first reading before), and the status timeline now shows **hourly bars for
  the 24h range** so activity is visible right away instead of only as days pass.
- **Status summary names the affected service.** Exactly one service down reads
  "{name} is down"; more than one reads "Multiple services down" (was the
  ungrammatical "1 of N service down") — in both the status page and the
  dashboard pill.
- **Admin app form:** the "Custom" up-when option now works from every preset and
  the help text updates per option.

### Changed

- The **admin portal** matches the rest of the app's width.
- **Change password** is now a "Reset password" button that opens a modal.
- Documented escaping special characters in `ADMIN_PASSWORD` (quote the value;
  double a literal `$` for docker compose) — a complex password can otherwise be
  mangled by `.env`/compose before the app sees it.

## [0.9.0] - 2026-06-23

### Added

- **Richer, redesigned weather page.** `/weather` now shows "feels like", an
  hourly forecast, a 7-day outlook with temperature range bars, a sunrise/sunset
  arc, and tiles for wind (speed + direction), chance of precipitation, humidity,
  UV, pressure, and cloud cover — in a refreshed layout that follows the active
  theme (with a subtle condition/time-aware accent on the hero).
- **Uptime history & charting on the status page.** `/status` shows a per-service
  uptime % (24h / 7d / 30d / 90d) and a 90-day daily timeline, recorded by a
  background poller that runs independent of page views. The check interval is
  admin-configurable (1 / 5 / 15 min).
- **Per-service status by HTTP code.** Each app can define which response codes
  count as "up" (e.g. `200-299`), so a reachable host returning a `404` reads as
  **down** rather than up. Set via an "Up when" control in the admin app form.
- **MIT license.**

### Changed

- Renamed the weather page's "Next 24 hours" heading to "Hourly forecast".

## [0.8.3] - 2026-06-22

### Added

- A **"Default" theme** at the top of the theme list (badged) that restores the
  app's stock look — Glass design, Aurora scene, and the default colors.

### Changed

- The **settings page is full-width**, and the preferences section is reorganized
  into a cleaner two-column layout with a clearer "Reset all settings" control.
- **Theme builder reorganized:** the Themes presets are grouped in their own
  section, visually separated by a "Customize" divider from the design/scene/
  color controls; naming and saving a theme now sits with the Themes section;
  and a dedicated **"Reset theme to default"** resets only the theme (distinct
  from "Reset all settings").

### Fixed

- Design-preview swatches no longer lift/shadow oddly when hovering the theme
  builder.
- The admin icon preview no longer sticks on the fallback letter after a
  transient load failure or while editing the slug.
- The "Use my location" button no longer reports a false timeout while the
  browser's permission prompt is still open (timeout raised to 30s).

## [0.8.2] - 2026-06-22

### Changed

- **Renamed the project to ctrlcenter.** Existing visitor theme/preference data
  (stored under the old `homepage:*` localStorage keys) resets to defaults; the
  admin config export is now `ctrlcenter-config.json`.
- **Theme builder: Themes now come first**, before Design and Scene.
- **Background overlays moved out of designs and into scenes.** Designs are
  surface-only now; the Grid scene gained a full-page grid backdrop so it serves
  as the replacement for the grid look the Bold and Cyber designs used to bake
  in — usable under any design.

## [0.8.1] - 2026-06-22

### Fixed

- **Admin login now works on the first attempt** — it previously bounced back to
  the login form and only succeeded after a manual reload.
- **The weather widget and the `/weather` page now refresh and stay in sync.**
  They were serving independently-cached snapshots that drifted apart and never
  refreshed within a session; both now fetch live on load and every 10 minutes.
- **Particle scenes read correctly on light backgrounds.** Starfield's stars and
  Abyss's marine snow were washing out on light; their effect colors now deepen
  to contrast with a light surface (dark is unchanged).

### Changed

- The settings page sections stack in a single column (theme builder last).
- The admin Settings tab and the `/weather` and `/status` pages now match the
  width of the rest of the UI instead of being narrower.

## [0.8.0] - 2026-06-22

### Added

- **Four new scenes** in the theme builder: _Nebula_ (drifting clouds of accent
  light), _Grid_ (a perspective grid to the horizon — synthwave on dark, a clean
  blueprint on light), _Starfield_ (twinkling, drifting stars), and _Waves_
  (layered waves along the base). Each has a cohesive light and dark treatment
  and honors `prefers-reduced-motion`.
- **Four new themes** showcasing them: _Nebula_, _Outrun_, _Observatory_, and
  _Tide_.

### Changed

- **"Packs" are now "Themes," and built-in and saved themes share one list.** A
  Theme is a scene + design + palette tailored for both light and dark; saving
  the current look adds a Theme alongside the built-ins, and saved ones can be
  removed inline.
- Removed the Abyss scene's depth-gauge ornament (it crowded the dashboard);
  Abyss keeps its bioluminescent backdrop and drifting marine snow.

### Fixed

- Light-mode legibility of faint text: bookmark category labels (previously a
  fixed light violet that washed out) now follow the theme accent and stay
  readable in both modes; app subtitles, section titles, and status-page hosts
  are no longer too pale on light backgrounds; and admin toasts read clearly on
  light pages.

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

[Unreleased]: https://github.com/boostctrl/ctrlcenter/compare/v1.9.8...HEAD
[1.9.8]: https://github.com/boostctrl/ctrlcenter/compare/v1.9.7...v1.9.8
[1.9.7]: https://github.com/boostctrl/ctrlcenter/compare/v1.9.6...v1.9.7
[1.9.6]: https://github.com/boostctrl/ctrlcenter/compare/v1.9.5...v1.9.6
[1.9.5]: https://github.com/boostctrl/ctrlcenter/compare/v1.9.4...v1.9.5
[1.9.4]: https://github.com/boostctrl/ctrlcenter/compare/v1.9.3...v1.9.4
[1.9.3]: https://github.com/boostctrl/ctrlcenter/compare/v1.9.2...v1.9.3
[1.9.2]: https://github.com/boostctrl/ctrlcenter/compare/v1.9.1...v1.9.2
[1.9.1]: https://github.com/boostctrl/ctrlcenter/compare/v1.9.0...v1.9.1
[1.9.0]: https://github.com/boostctrl/ctrlcenter/compare/v1.8.5...v1.9.0
[1.8.5]: https://github.com/boostctrl/ctrlcenter/compare/v1.8.4...v1.8.5
[1.8.4]: https://github.com/boostctrl/ctrlcenter/compare/v1.8.3...v1.8.4
[1.8.3]: https://github.com/boostctrl/ctrlcenter/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/boostctrl/ctrlcenter/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/boostctrl/ctrlcenter/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/boostctrl/ctrlcenter/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/boostctrl/ctrlcenter/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/boostctrl/ctrlcenter/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/boostctrl/ctrlcenter/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/boostctrl/ctrlcenter/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/boostctrl/ctrlcenter/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/boostctrl/ctrlcenter/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/boostctrl/ctrlcenter/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/boostctrl/ctrlcenter/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/boostctrl/ctrlcenter/compare/v1.1.4...v1.2.0
[1.1.4]: https://github.com/boostctrl/ctrlcenter/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/boostctrl/ctrlcenter/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/boostctrl/ctrlcenter/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/boostctrl/ctrlcenter/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/boostctrl/ctrlcenter/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/boostctrl/ctrlcenter/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/boostctrl/ctrlcenter/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.9...v1.0.0
[0.9.9]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.8...v0.9.9
[0.9.8]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.7...v0.9.8
[0.9.7]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/boostctrl/ctrlcenter/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/boostctrl/ctrlcenter/compare/v0.8.3...v0.9.0
[0.8.3]: https://github.com/boostctrl/ctrlcenter/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/boostctrl/ctrlcenter/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/boostctrl/ctrlcenter/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/boostctrl/ctrlcenter/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/boostctrl/ctrlcenter/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/boostctrl/ctrlcenter/compare/v0.5.3...v0.6.0
[0.5.3]: https://github.com/boostctrl/ctrlcenter/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/boostctrl/ctrlcenter/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/boostctrl/ctrlcenter/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/boostctrl/ctrlcenter/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/boostctrl/ctrlcenter/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/boostctrl/ctrlcenter/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/boostctrl/ctrlcenter/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/boostctrl/ctrlcenter/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/boostctrl/ctrlcenter/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/boostctrl/ctrlcenter/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/boostctrl/ctrlcenter/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/boostctrl/ctrlcenter/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/boostctrl/ctrlcenter/releases/tag/v0.1.0
