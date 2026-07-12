"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

// A horizontal scroller (a tablist, a chip strip, an hourly forecast) can clip
// content off either edge with nothing to signal that more is there. This fades
// the row to transparent over `fade` px on whichever side has more to scroll
// toward, opaque across the rest, and no mask at all when nothing is clipped.
// Masking the row itself rather than laying a gradient overlay on top means the
// fade works over any surface color — an overlay would have to guess the color
// behind it.
//
// Attach the returned `ref` and `onScroll` to the scroller and spread `style`.
// Extracted from the theme builder's tablist (#125) so the app's horizontal
// scrollers share one implementation and fade tweaks happen in one place (#143).
export function useEdgeFade<T extends HTMLElement>(fade = 24) {
  const ref = useRef<T>(null);
  const [clip, setClip] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 0;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    // Scroll fires this many times per swipe; returning the previous object
    // when nothing changed lets React bail out instead of re-rendering per event.
    setClip((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end }
    );
  }, []);

  useEffect(() => {
    // Effect-only so it never runs during SSR: the first measure and the
    // ResizeObserver both need a live element. The content may be static, but
    // the viewport isn't — a resize can clip or reveal an edge without a scroll.
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const mask = `linear-gradient(to right, ${[
    clip.start ? `transparent 0, black ${fade}px` : "black 0",
    clip.end ? `black calc(100% - ${fade}px), transparent 100%` : "black 100%",
  ].join(", ")})`;
  const style: CSSProperties | undefined =
    clip.start || clip.end
      ? { maskImage: mask, WebkitMaskImage: mask }
      : undefined;

  return { ref, onScroll: measure, style };
}
