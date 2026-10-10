"use client";

import type { CSSProperties } from "react";
import { packDesign, packScene, type ThemePack } from "@/lib/theme";
import { themePaint } from "@/lib/theme-paint";
import type { Mode } from "../prefs/themeApply";
import { deepenForLight } from "../scenes/color";
import { PreviewCard } from "./PreviewCard";
import { scenePreview } from "./scenePreview";

// A pack rendered as the builder's preview card (#334), in its own design,
// scene, colors, tune, fonts and status colors for one mode, without touching
// the page: the resolver computes the same variables it paints on <html>,
// and they're set on a wrapper instead, with the design and mode classes the
// stylesheet keys its tokens on. The admin Themes tab shows every pack this
// way, so an edit is seen as visitors will see it.
export function PackPreview({ pack, mode }: { pack: ThemePack; mode: Mode }) {
  const dark = mode === "dark";
  const cs = dark ? pack.dark : pack.light;
  const paint = themePaint.computePaint({
    dark,
    background: cs.background,
    foreground: cs.foreground,
    accentFrom: cs.accentFrom,
    accentTo: cs.accentTo,
    tune: pack.tune ?? null,
    status: (dark ? pack.status : pack.statusLight ?? pack.status) ?? null,
  });
  const style: Record<string, string> = {};
  for (const [k, v] of Object.entries(paint.vars)) if (v !== null) style[k] = v;
  const from = dark ? cs.accentFrom : `rgb(${deepenForLight(cs.accentFrom)})`;
  const to = dark ? cs.accentTo : `rgb(${deepenForLight(cs.accentTo)})`;
  const design = packDesign(pack, dark);
  const scene = packScene(pack, dark);
  const classes = [
    dark ? "" : "theme-light",
    design === "glass" ? "" : `design-${design}`,
    pack.font && pack.font !== "jakarta" ? `font-${pack.font}` : "",
    pack.headingFont ? `heading-${pack.headingFont}` : "",
    "overflow-hidden rounded-lg p-2 font-sans text-fg",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={classes}
      style={{ ...(style as CSSProperties), background: scenePreview(scene, from, to), color: cs.foreground }}
      data-testid="pack-preview"
    >
      <PreviewCard mode={mode} />
    </div>
  );
}
