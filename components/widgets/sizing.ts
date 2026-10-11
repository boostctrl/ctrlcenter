import type { CSSProperties } from "react";
import type { LayoutWidget } from "@/lib/layout";
import { SIZED_WIDGET_TYPES } from "@/lib/layout";

// How a grid cell takes a widget's explicit height (#353), shared by the live
// cell in Dashboard and the editor's preview box in LayoutEditor so the frame
// measures exactly what ships.
//
// The content widgets (`sized` in lib/widgets/defs.ts) keep their heading and
// scroll the rest inside it — the card itself, or a tile grid's own scroll box
// (.widget-sized in globals.css). They take the height at every size: they
// can't crop. The others center their content in it (so a sized greeting
// sits centered beside the header card, restoring the classic header) on lg+
// only, like spans: below lg cells stack full-width, contents grow taller
// (the header card's rows stack), and a height tuned against the desktop
// row would silently crop them (#105) — auto height is what a phone wants
// there. Their content sits in a clip box (`clip`: the caller wraps the node
// in .widget-clip) that stands off the cell by --cell-bleed above and below
// and half the column gap beside, so the card's shadow isn't cut flat at the
// cell edge in any engine — an inner box, not overflow-clip-margin, which
// Safari lacks (#354).
export type CellSizing = { className: string; style?: CSSProperties; clip?: boolean };

export function cellSizing(widget: Pick<LayoutWidget, "type" | "height">): CellSizing {
  if (!widget.height) return { className: "" };
  if (SIZED_WIDGET_TYPES.includes(widget.type)) {
    return { className: "widget-sized", style: { height: widget.height } };
  }
  return {
    className: "widget-centered lg:flex lg:h-[var(--widget-height)] lg:flex-col lg:justify-center",
    style: { "--widget-height": `${widget.height}px` } as CSSProperties,
    clip: true,
  };
}

// The most a sized cell's shadow allowance reaches past its edge (px): far
// enough for every design's resting shadow, short enough that a cut-off row's
// fade stays a hint. Within the row gap, so it never crosses a neighbour.
export const MAX_CELL_BLEED = 40;

// The --cell-bleed value for a grid with this row gap (px): the gap, capped.
// A plain length, never calc()/min() — Chromium rejects those in
// overflow-clip-margin (the safety net in globals.css), and a rejected value
// clips at the edge again.
export function cellBleed(gap: number): string {
  return `${Math.max(0, Math.min(Math.round(gap), MAX_CELL_BLEED))}px`;
}
