---
name: new-scene
description: Add a new scene (animated or still backdrop) to the theme builder, or change what an existing scene id renders. Walks every registry a scene touches (ids, component, swatch, CSS stilling lists, counts in tests/README/help), the motion and colour contracts, and the smoke coverage. Candidates live in tracker issue #348.
---

# Add a scene

A scene is the backdrop behind everything: the composition, its motion and an
optional signature ornament. It is one id in `lib/theme.ts`, one React
component, one registry entry and one swatch — plus the hand-maintained CSS
lists and the hard-coded counts that are easy to forget. Two registries are
typed over every `SceneId` (`SCENE_REGISTRY` and the swatch record), so
`npm run typecheck` fails until the new id has both. Work through the steps
in order.

## 1. Id and catalog row: `lib/theme.ts`

- Add the id to the `SceneId` union and a row to `SCENES`: `id`, `name`, a
  one-line `description` (the picker's subtitle and tooltip), and
  `still: true` if the scene never moves (it gets a "Still" badge in the
  pickers and is exempt from the motion contract below). `none` stays first.
- Never reuse a retired id (`glow`, `vortex`, `mesh`): the 3.0 migration maps
  them to Aurora.

## 2. Component: `components/scenes/<Name>.tsx`

The signature is `({ light, motion }: SceneProps)` from `./index`: `light`
is the resolved surface lightness, `motion` the level the scene should run
at (`"normal"` as designed, `"calm"` at half speed, `"off"` a still frame).

- Root: `<div aria-hidden className="scene-root pointer-events-none fixed inset-0 -z-10 overflow-hidden">`.
  `.scene-root` applies `--scene-opacity` (the Intensity slider). A glow
  scene (soft gradients a design may dim or switch off: Aurora, Rays, Peaks,
  Blueprint) also multiplies in `--glow-opacity`:
  `style={{ opacity: "calc(var(--glow-opacity, 1) * var(--scene-opacity, 1))" }}`.
  Particle/canvas scenes are not glow-gated.
- **Colours.** Never hard-code a hue. CSS scenes read `var(--scene-from)` and
  `var(--scene-to)` (the accent pair, already deepened for light surfaces by
  the resolver) and tint with `color-mix(in srgb, var(--scene-from) NN%, transparent)`.
  Canvas scenes read `effectRgbFor(light, "--accent-from" | "--accent-to")`
  from `./color` (an `"r, g, b"` string, deepened on light) inside `resize()`
  so a theme change recolours on the next layout. Light surfaces get a 40%
  page-colour wash over the scene (`SceneLayer.tsx`), so raise alphas a touch
  for `light`.
- **Motion contract.** Every scene must honour all three levels and the OS
  preference:
  - *CSS scenes* animate with a class and a keyframe in `app/globals.css`
    (step 4). `[data-motion="calm"]` sets `--motion-scale: 2.5`, so every
    class declares `animation-duration: calc(<N>s * var(--motion-scale, 1))`;
    the two stilling lists set `animation: none` for `off` and for
    `prefers-reduced-motion`. The component itself needs no motion code.
  - *Canvas scenes* copy `components/scenes/Petals.tsx`: compute
    `reduced = motion === "off" || matchMedia("(prefers-reduced-motion: reduce)").matches`
    and `calm = motion === "calm"`; `resize()` re-seeds the field and, when
    reduced, draws one still frame; `draw()` skips every other frame under
    calm; `window.addEventListener("resize", resize)` plus
    `cancelAnimationFrame(raf)` in the effect cleanup; the effect depends on
    `[light, motion]`. Size the canvas by `devicePixelRatio`, cap the particle
    count by viewport width, and pre-render any expensive sprite once in
    `resize()` rather than per frame.
  - Photosensitivity (WCAG 2.3.1): no field-wide luminance change faster
    than about 1 Hz; per-particle flicker stays under 2 Hz.
- A still scene (`still: true`) draws nothing that moves and ignores `motion`.

## 3. Registry and swatch

- `components/scenes/index.ts`: import the component and add it to
  `SCENE_REGISTRY` (typed `Record<SceneId, …>`).
- `components/theme-builder/scenePreview.ts`: add a swatch to
  `SCENE_SWATCHES` (typed `Record<SceneId, …>`): a small CSS `background`
  built from `from`, `to`, `bg` and `mix(colour, pct)` that reads as the scene
  at 40 px tall, ending in `${bg}`. It paints the scene tile in the Scene tab
  and every theme tile and pack preview that uses the scene.

## 4. CSS: `app/globals.css` (CSS-animated scenes only)

- Add the `@keyframes` and an `.animate-<scene>` class next to the other
  scene animations, with the `--motion-scale` duration above.
- Add the class to **both** stilling lists at the end of that block: the
  `@media (prefers-reduced-motion: reduce)` list and the
  `[data-motion="off"]` list. A class missing from either keeps moving for
  visitors who asked it not to.
- Any `.scene-<id>` rule (a class the resolver sets on `<html>`) goes beside
  the other per-scene rules.

## 5. Counts and lists

- `lib/theme.test.ts` "catalog sizes": `SCENES` length (ids including
  `none`) and the test title.
- `README.md`: the Scenes bullet under Theming (count and id list) and the
  `scene:` comment in the config reference.
- `app/help/page.tsx` "Themes & looks": the scene examples; the count is
  derived from `SCENES.length - 1`, so leave the number alone.
- `docs/ROADMAP_3.0.md` if it quotes the catalog size.

## 6. A showcase theme (optional)

A pack is one row appended at the **end** of `THEME_PACKS` in `lib/theme.ts`
(gallery order; materialised galleries append new built-ins). Its colours
must pass `lib/theme-paint.test.ts` (button ink 4.5:1, ink on a 10% card
fill 4.5:1, both modes); bump the pack count in `lib/theme.test.ts`, the
README and the help page.

## 7. Verify

- `npm run lint && npm run typecheck && npm test && npm run build && npm run smoke`.
  The smoke run renders every scene no pack uses once (dark, reduced
  motion), every pack's scene in both schemes, and one full-motion render,
  so a scene that throws in `requestAnimationFrame` fails CI.
- The **visual-verify** skill on `/` with the new scene applied: dark and
  light × motion normal, calm and off, and `ctrlcenter:motion=reduce`, on
  Glass (glow 1) and Flat (glow 0). Expect one still frame under off, no
  page or console errors, and cards still readable; check tiles at 1× and
  2× DPR for seams.

## 8. Finish

- CHANGELOG entry under `## [Unreleased]`, written for end users (what the
  scene looks like), with the issue reference (`(#NN)`). File and label the
  issue first if it doesn't exist; check tracker #348.
