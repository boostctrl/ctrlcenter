"use client";

import type { CSSProperties } from "react";
import type { ColorSet, DesignId, SceneId } from "@/lib/theme";
import type { Mode } from "../prefs/themeApply";
import { deepenForLight } from "../scenes/color";
import { scenePreview } from "./scenePreview";

// A theme's swatch (#328): a miniature card in the theme's design over its
// scene, in that mode's colors — so a tile shows what the theme does, not
// just its gradient. The mode's colors are set as the CSS variables the
// design tokens read, scoped to the tile, so a Cyber tile glows in its own
// accent and a Paper tile fills with its own ink whatever the page shows.
export function ThemeTile({
  design,
  scene,
  colors,
  mode,
}: {
  design: DesignId;
  scene: SceneId;
  colors: ColorSet;
  mode: Mode;
}) {
  // The scene swatch paints the accent deepened on light, as the scenes do.
  const from = mode === "light" ? `rgb(${deepenForLight(colors.accentFrom)})` : colors.accentFrom;
  const to = mode === "light" ? `rgb(${deepenForLight(colors.accentTo)})` : colors.accentTo;
  const vars = {
    "--background": colors.background,
    "--foreground": colors.foreground,
    "--fg": colors.foreground,
    "--accent-from": colors.accentFrom,
    "--accent-to": colors.accentTo,
    "--scene-from": from,
    "--scene-to": to,
    background: scenePreview(scene, from, to),
  } as CSSProperties;
  return (
    <span
      className={`${mode === "light" ? "theme-light " : ""}block h-12 w-full overflow-hidden rounded-md p-1.5 ring-1 ring-fg/10`}
      style={vars}
      aria-hidden
    >
      <span className={`${design === "glass" ? "" : `design-${design} `}block h-full`}>
        <span className="glass-card flex h-full items-center gap-1.5 px-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colors.foreground, opacity: 0.6 }} />
          <span
            className="h-1 w-7 rounded-full"
            style={{ backgroundImage: `linear-gradient(to right, ${colors.accentFrom}, ${colors.accentTo})` }}
          />
        </span>
      </span>
    </span>
  );
}
