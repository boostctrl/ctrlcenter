---
name: new-widget
description: Add a new widget type to the home-page dashboard grid, or change what an existing widget id renders. Walks every registry touchpoint and the config-migration traps — widget ids ripple through the schema, resolver, Dashboard, layout editor, and help page. Candidates live in tracker issue #79.
---

# Add a widget to the layout grid

A widget id ripples through several files that must stay in agreement. Work
through the touchpoints in order; skipping one produces a widget that renders
but can't be arranged, or arranges but renders nothing.

## 1. Registry — `lib/layout.ts` (the source of truth)

- Add the id to `LAYOUT_WIDGET_IDS` and a human label to `WIDGET_LABELS`.
- Add an entry to `DEFAULT_WIDGETS` with a default `span` (grid is 24 columns;
  24 = full row, 8 = third) and a deliberate `hidden` choice — **this is the
  upgrade-path decision**: `resolveLayoutWidgets` appends any widget missing
  from a saved layout using its default, so `hidden: false` makes the new
  widget appear on every existing dashboard after upgrade, while
  `hidden: true` ships it dormant until the admin enables it in the layout
  editor. New widgets should almost always ship `hidden: true` (the split
  clock/weather/status widgets set the precedent).
- If the widget shows a grid of cards, add it to `CARD_WIDGET_IDS` — that's
  what grants it the cards-per-row stepper in the layout editor.
- Do **not** touch `HEADER_WIDGET_IDS`: it's a frozen legacy list that decides
  which missing widgets get *prepended* (old fixed-header position) instead of
  appended. New widgets are body widgets.

## 2. Settings schema — `lib/schema.ts` (only if configurable)

The layout entry itself needs no schema change (it's generic by id). But if the
widget has its own settings (like the calendar's iCal URL), add them to the
stored-config schema **leniently** (`.catch()` on every field — a bad stored
value must never fail the whole config load) and to the strict admin PUT
schemas further down the file. Follow `calendarSchema` as the template.

## 3. Component — `components/widgets/YourWidget.tsx`

Follow `ClockWidget`/`WeatherWidget` for a self-contained widget. Server-fetched
data comes in as props wired through `app/page.tsx` → `Dashboard`.

## 4. Dashboard — `components/Dashboard.tsx`, three switches

- `blockFor(widget)`: return the widget's node, or `null` when it has nothing
  to show (feature off, no data). Note the edit-mode contract in the comment
  above it: in edit mode, search filtering and content-gates are suspended so
  every widget previews real content.
- `emptyReason(id)`: the edit-mode placeholder text explaining *why* the cell
  is empty and where to fix it ("… enable X in the admin Y settings").
- `CELL_ALIGN` if the widget needs non-default vertical alignment.

## 5. Tests — `lib/layout.test.ts`

The resolver tests enumerate expected widget lists, so adding an id breaks
them — that's the guard working. Update the expectations and add a case for
your widget's upgrade path: a saved layout *without* the new id must resolve
with the widget appended, carrying your chosen default span/hidden.

## 6. Docs and finish

- Describe the widget in the `/help` page (`app/help/page.tsx`).
- CHANGELOG entry under `## [Unreleased]`, written for end users, referencing
  the issue (`(#NN)`). File/label the issue first if it doesn't exist; check
  tracker #79.
- Quality gate, then run the **visual-verify** skill: check `/` with the widget
  enabled, hidden, and at narrow spans, in light and dark. Also verify the
  upgrade path live: point `CONFIG_PATH` at a copy of a config saved before
  your change and confirm the page renders unchanged.
