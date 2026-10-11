"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The box around a tile grid (favorites, apps, bookmarks): nothing at auto
// height; at an explicit height the scroll box, padded out so the tiles'
// shadows aren't cut at the cell edge (.widget-sized in globals.css, #353).
// Inside the @container section, so its padding never moves the column
// thresholds.
//
// `data-overflow` marks the box only while its rows actually overflow it: the
// fade that dissolves a cut-off row is a mask, and a masked box is a backdrop
// root, so the frosted designs' tiles would lose their blur even when every
// row fits. Measured in an effect (ResizeObserver, like useEdgeFade) — absent
// on the server and at auto height, where nothing scrolls.
export default function TilesBox({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className="widget-tiles" data-overflow={overflow || undefined}>
      {children}
    </div>
  );
}
