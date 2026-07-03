"use client";

import { useEffect } from "react";
import { SPACE_SIDES, type SpaceSide } from "@/lib/layout";

// Owns the dashboard grid's vertical layout so React and this effect never
// fight over the same inline style. React sets each cell's explicit height
// (style.height) and data-space-* attributes; this effect sets everything else
// — the grid's auto-rows and row-gap, and each cell's row-span / margins.
//
// Two modes, by viewport (identical in the editor and the live page, so the
// editor previews exactly what ships):
//  • pack (lg+): masonry. Rows become a fine track (ROW_UNIT) with no row-gap,
//    and each cell gets a row-span from its measured height plus the grid gap
//    and its own top/bottom space, so cards pack up the columns yet keep an
//    even, tunable gap. Auto-placement is sparse (no dense flow — see
//    Dashboard), so cards stay in the order they're placed.
//  • linear (below lg): a plain single-column grid — row-gap provides the
//    spacing and a cell's space is applied as margins.
//
// Explicit heights work in both modes: React sizes the cell, we just measure it
// (pack) or leave it (linear). A cell taller than its content gives the card
// presence; the header widgets center their content in it (see Dashboard).
const ROW_UNIT = 4; // px per implicit row track in pack mode

type Space = Record<SpaceSide, number>;

export function useGridLayout(
  ref: React.RefObject<HTMLDivElement | null>,
  gap: number,
  // Bumps whenever gap / heights / per-side space / edit mode / the cell set
  // change, so the layout is recomputed for the new values.
  signature: string
) {
  useEffect(() => {
    const grid = ref.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let frame = 0;

    const cells = () => Array.from(grid.children) as HTMLElement[];
    const spaceOf = (cell: HTMLElement): Space => {
      const out = { top: 0, right: 0, bottom: 0, left: 0 };
      for (const side of SPACE_SIDES) {
        out[side] = Number(cell.dataset[`space${side[0].toUpperCase()}${side.slice(1)}`]) || 0;
      }
      return out;
    };

    const clearCell = (cell: HTMLElement) => {
      cell.style.removeProperty("margin-top");
      cell.style.removeProperty("margin-right");
      cell.style.removeProperty("margin-bottom");
      cell.style.removeProperty("margin-left");
      cell.style.removeProperty("grid-row-end");
    };

    const layout = () => {
      const pack = mq.matches;
      const list = cells();
      // Reset per-cell props first so a mode/space change never leaves a stale
      // margin or span behind (and heights measure unconstrained).
      for (const cell of list) clearCell(cell);
      if (pack) {
        grid.style.gridAutoRows = `${ROW_UNIT}px`;
        grid.style.rowGap = "0px";
        // Read all heights first, then write spans — reflow at most twice.
        const heights = list.map((c) => c.getBoundingClientRect().height);
        list.forEach((cell, i) => {
          const s = spaceOf(cell);
          if (s.top) cell.style.marginTop = `${s.top}px`;
          if (s.left) cell.style.marginLeft = `${s.left}px`;
          if (s.right) cell.style.marginRight = `${s.right}px`;
          // Top + bottom space and the grid gap ride in the row-span as extra
          // empty tracks; marginTop offsets the content, the rest sits below.
          const span = Math.max(
            1,
            Math.ceil((heights[i] + s.top + s.bottom + gap) / ROW_UNIT)
          );
          cell.style.gridRowEnd = `span ${span}`;
        });
      } else {
        grid.style.removeProperty("grid-auto-rows");
        grid.style.rowGap = `${gap}px`;
        for (const cell of list) {
          const s = spaceOf(cell);
          if (s.top) cell.style.marginTop = `${s.top}px`;
          if (s.right) cell.style.marginRight = `${s.right}px`;
          if (s.bottom) cell.style.marginBottom = `${s.bottom}px`;
          if (s.left) cell.style.marginLeft = `${s.left}px`;
        }
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };

    const observe = () => {
      ro?.disconnect();
      ro = new ResizeObserver(schedule);
      ro.observe(grid);
      for (const cell of cells()) ro.observe(cell);
      layout();
    };

    observe();
    mo = new MutationObserver(observe); // cells come and go (shown/hidden/filtered)
    mo.observe(grid, { childList: true });
    mq.addEventListener("change", observe);

    return () => {
      mq.removeEventListener("change", observe);
      ro?.disconnect();
      mo?.disconnect();
      cancelAnimationFrame(frame);
      grid.style.removeProperty("grid-auto-rows");
      grid.style.removeProperty("row-gap");
      for (const cell of cells()) clearCell(cell);
    };
  }, [ref, gap, signature]);
}
