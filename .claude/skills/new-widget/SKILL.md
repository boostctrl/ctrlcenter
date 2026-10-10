---
name: new-widget
description: Add a new widget type to the home-page dashboard grid, or change what an existing widget id renders. Walks the widget registries (metadata, renderer, data loader, admin editor, help) and the config-migration traps. Candidates live in tracker issue #79.
---

# Add a widget to the layout grid

Since #285 every widget type is described by keyed entries in a few small
registries, one per concern. The server/client boundary is why there are
several: metadata is shared, renderers are client code, loaders are
server-only. Work through them in order. The renderer registry is typed over
every widget type, so `npm run typecheck` fails until the new type has one.

Since 3.0 (#297) what sits on the board is an **instance** of a type: an entry
in the top-level `widgets` list (`{ id, type, ...content }`), placed on a
board by a layout row `{ widget: <id>, span, … }` in `boards[].layout.sections`
(#298). A type can appear any number of times, on any number of boards, and
its content lives on the instance, never in `settings`. Loaders only see the
board being rendered, and a guest only receives the instances that board
shows, so a widget's data must come through its loader and instance, never a
site-wide lookup.

## 1. Metadata: `lib/widgets/defs.ts` (the source of truth)

Add an entry to `WIDGET_DEFS`. Its position is the default layout order, and
a fresh config gets one instance of it named after the type.

- `id` and `label` (the label shows in the layout editor's frame and tray).
- `span`: the default width on the 24-column grid (24 is a full row, 8 a
  third).
- `hidden`: whether the stock layout shows it. An existing config has no
  instance of a new type, so nothing changes there until the admin adds one;
  an instance no layout row places waits hidden in the editor's tray.
- Capabilities:
  - `cards`: a grid of cards; gets the cards-per-row stepper.
  - `titled`: has a section heading the editor can toggle.
  - `sized`: scrolls at an explicit height instead of centering.
  - `align`: extra cell classes.
- `empty`: the edit-mode placeholder that says why the cell is empty and where
  to fix it ("… enable X in admin Settings → Widgets → Y").
`lib/layout.ts` derives `WIDGET_TYPES`, `WIDGET_LABELS`, `DEFAULT_SECTIONS`
and the capability lists from this table, so don't edit those directly.

## 2. Instance schema: `lib/schema/instances.ts`

Add the type to `widgetInstanceSchema` (the tagged union) and to the stock
list in `DEFAULT_INSTANCES`; a test fails if the union and the registry
disagree. A type with no content is just `{ ...base, type: z.literal("x") }`.
If it has content:

- Give every field a default (and `.catch()` where a bad hand-edited value is
  likely), so an instance never fails to parse; one that does is dropped.
- Put any admin-only rule (a URL scheme, a list cap) in
  `widgetInstancesUpdateSchema`'s `superRefine`; the input is otherwise
  derived from the stored shape.
- Mark any credential field with `secretFields` (`lib/schema/meta.ts`); the
  redaction guard test walks the instance union and fails otherwise. Follow
  the calendar's `username`/`password` as the template.

## 3. Render: `components/widgets/`

- Write the component (`components/widgets/YourWidget.tsx`). Follow
  `NotesWidget`/`ClockWidget`.
- Add its renderer to `WIDGET_RENDERERS` in `components/widgets/registry.tsx`.
  - It returns the node, or `null` when there's nothing to show. It reads its
    own instance with `instanceOf(type, widget, ctx.data)`, server data from
    `ctx.data` (keyed by instance id), plus the live state (`editing`, `q`,
    search).
  - Mind the edit-mode contract in that file's header: in edit mode, search
    gates are suspended so every widget previews real content.
  - Titled widgets honour `widget.hideLabel`.

## 4. Server data: `lib/widgets/` (only if it needs any)

- Content from config needs nothing: the instance is already in
  `data.instances`.
- If it's fetched at request time, add a loader to `LOADERS`
  (`lib/widgets/load.tsx`) that works through `shownOf(ctx, "<type>")`, one
  result per instance id (into `nodes`, or a new per-id map on `HomeData`).
  Loaders run concurrently.
  - Time-box the fetch.
  - Degrade to null on failure.
  - `shownOf` already skips instances that can't show (hidden, for a guest).
  - Credentials come from server-only accessors and never go into `HomeData`.

## 5. Admin editor: `components/admin/settings/widgets/` (if configurable)

Add `YourWidgetSettings.tsx`: the fields for one instance, taking
`InstanceEditorProps<"yourType">` (`{ w, label, onChange }`; see
`NotesSettings`). It owns any keyed row lists itself. List it in
`INSTANCE_GROUPS` in `index.ts` with a title, intro and Add label; the Widgets
section wraps each instance with its name, show switch and Remove. A type
without content needs no editor (the Layout section lists its show switches).

## 6. Help: `app/help/widget-help.tsx`

Add a `{ title, body }` entry under the widget's id. It renders as a card under
"For admins: the home page", in registry order, and joins the table of
contents automatically.

## 7. Tests

- `lib/layout.test.ts` enumerates the stock arrangement, so adding a type
  breaks it. That's the guard working; update the expectations.
- `lib/widgets/defs.test.ts` checks labels, spans, empty reasons, and that
  the instance union matches the registry.
- Never touch `lib/config-migrate-v3.ts`: its widget table is frozen as of
  2.13, describing what a v2 config contained.

## 8. Finish

- CHANGELOG entry under `## [Unreleased]`, written for end users, with the
  issue reference (`(#NN)`). File and label the issue first if it doesn't
  exist; check tracker #79.
- Run the quality gate, then the **visual-verify** skill.
  - Check `/` with the widget enabled, hidden, and at narrow spans, in light
    and dark.
  - Check the editor (empty placeholder, tray) and admin Settings → Widgets.
  - Verify the upgrade path live: point `CONFIG_PATH` at a copy of a config
    saved before your change and confirm the page renders unchanged.
  - Add a second instance in Settings → Widgets and confirm both render
    independently.
