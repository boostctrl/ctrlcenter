"use client";

import { useCallback, useRef } from "react";

// Brings an add/edit form into view and focuses its first field. On phones the
// admin managers stack the form below the whole list, so "Edit" on a row used
// to fill a form the admin couldn't see, and adding meant scrolling past every
// existing item (#272). Scrolls only when the form isn't already on screen.
export function useRevealForm<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const reveal = useCallback(() => {
    // After the click's state update has rendered the form's new contents.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const { top } = el.getBoundingClientRect();
      if (top < 0 || top > window.innerHeight * 0.6) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
      el.querySelector<HTMLElement>("input, select, textarea")?.focus({
        preventScroll: true,
      });
    });
  }, []);
  return { ref, reveal };
}
