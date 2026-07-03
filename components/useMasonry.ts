"use client";

import { useEffect } from "react";

// Vertical masonry for the dashboard grid. With content-height cards a short
// card beside a tall one leaves ragged vertical dead space (the row waits for
// its tallest card). Native CSS masonry isn't broadly supported, so we turn the
// grid's rows into a fine track (ROW_UNIT) with no row-gap and give each cell a
// row-span derived from its measured height plus a fixed visual GAP. Combined
// with grid-auto-flow: dense (already on in view mode) the cards pack
// independently up the columns — a later card rises into the gap beside a taller
// neighbour — while keeping an even gap between stacked cards.
//
// Client-only, lg-and-up (below lg the single column just stacks), and disabled
// while editing so the layout editor keeps its predictable linear flow.
const ROW_UNIT = 4; // px height of each implicit row track
const GAP = 32; // px of visual space kept below each card (matches gap-x-8)

export function useMasonry(
  ref: React.RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    const grid = ref.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let frame = 0;

    const cells = () => Array.from(grid.children) as HTMLElement[];

    const clear = () => {
      grid.style.removeProperty("grid-auto-rows");
      grid.style.removeProperty("row-gap");
      for (const cell of cells()) cell.style.removeProperty("grid-row-end");
    };

    // Batch reads then writes so the browser reflows at most twice: clear every
    // span, measure each card's natural height, then assign the spans.
    const layout = () => {
      const list = cells();
      for (const cell of list) cell.style.removeProperty("grid-row-end");
      const heights = list.map((c) => c.getBoundingClientRect().height);
      list.forEach((cell, i) => {
        const span = Math.max(1, Math.ceil((heights[i] + GAP) / ROW_UNIT));
        cell.style.gridRowEnd = `span ${span}`;
      });
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };

    // (Re)observe the current children — cells come and go as widgets are shown,
    // hidden, or filtered by a search — and relayout.
    const observeCells = () => {
      ro?.disconnect();
      ro = new ResizeObserver(schedule);
      ro.observe(grid);
      for (const cell of cells()) ro.observe(cell);
      layout();
    };

    const activate = () => {
      grid.style.gridAutoRows = `${ROW_UNIT}px`;
      grid.style.rowGap = "0px";
      observeCells();
      mo = new MutationObserver(observeCells);
      mo.observe(grid, { childList: true });
    };

    const deactivate = () => {
      ro?.disconnect();
      mo?.disconnect();
      ro = mo = null;
      cancelAnimationFrame(frame);
      clear();
    };

    const apply = () => {
      deactivate();
      if (enabled && mq.matches) activate();
    };

    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      deactivate();
    };
  }, [ref, enabled]);
}
