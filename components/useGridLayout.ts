"use client";

import { useEffect } from "react";

// Owns the dashboard grid's vertical layout so React and this effect never
// fight over the same inline style. React sets each cell's explicit height
// (style.height) and a data-space-below attribute; this effect sets everything
// else — the grid's auto-rows and row-gap, and each cell's row-span / margin.
//
// Two modes:
//  • pack (view + lg): masonry. Rows become a fine track (ROW_UNIT) with no
//    row-gap, and each cell gets a row-span from its measured height plus the
//    grid gap and its own space-below, so cards pack up the columns (with
//    grid-auto-flow: dense) yet keep an even, tunable gap.
//  • linear (editing, or below lg): a plain grid — row-gap provides the spacing
//    and a cell's space-below is an extra bottom margin. Keeps the editor
//    predictable and the single mobile column simple.
//
// Explicit heights work in both modes: React sizes the cell, we just measure
// it (pack) or leave it (linear). A cell taller than its content gives the card
// presence; the header widgets center their content in it (see Dashboard).
const ROW_UNIT = 4; // px per implicit row track in pack mode

export function useGridLayout(
  ref: React.RefObject<HTMLDivElement | null>,
  editing: boolean,
  gap: number,
  // Bumps whenever gap / heights / space-below / the cell set change, so the
  // layout is recomputed for the new values.
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
    const spaceBelowOf = (cell: HTMLElement) =>
      Number(cell.dataset.spaceBelow) || 0;

    const layout = () => {
      const pack = !editing && mq.matches;
      const list = cells();
      if (pack) {
        grid.style.gridAutoRows = `${ROW_UNIT}px`;
        grid.style.rowGap = "0px";
        // Read all heights first, then write spans — reflow at most twice.
        for (const cell of list) {
          cell.style.removeProperty("margin-bottom");
          cell.style.removeProperty("grid-row-end");
        }
        const heights = list.map((c) => c.getBoundingClientRect().height);
        list.forEach((cell, i) => {
          const span = Math.max(
            1,
            Math.ceil((heights[i] + gap + spaceBelowOf(cell)) / ROW_UNIT)
          );
          cell.style.gridRowEnd = `span ${span}`;
        });
      } else {
        grid.style.removeProperty("grid-auto-rows");
        grid.style.rowGap = `${gap}px`;
        for (const cell of list) {
          cell.style.removeProperty("grid-row-end");
          const sb = spaceBelowOf(cell);
          if (sb > 0) cell.style.marginBottom = `${sb}px`;
          else cell.style.removeProperty("margin-bottom");
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
      for (const cell of cells()) {
        cell.style.removeProperty("grid-row-end");
        cell.style.removeProperty("margin-bottom");
      }
    };
  }, [ref, editing, gap, signature]);
}
