"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

// The focusable descendants a keyboard user could already Tab to, which
// scroll the box into view on their own.
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

// The live grid cell of a content widget at an explicit height (#353): the
// box that scrolls is the widget's own last box (section > .glass-card or
// section > .widget-tiles). While that box actually overflows and holds
// nothing focusable — a Notes card, a System stats card, a Countdown — it is
// made a Tab stop (tabindex 0, a region named after the section's heading),
// so a keyboard user can scroll it in every browser: Chrome and Firefox do
// this for such scrollers on their own, Safari does not (#355). A box whose
// rows fit, or one with links or buttons inside, gets no extra stop.
// Measured with a ResizeObserver, like TilesBox; re-checked on every render
// in case the widget swapped its box.
export default function SizedCell({
  className,
  style,
  children,
  ...rest
}: {
  className: string;
  style?: CSSProperties;
  children: ReactNode;
  [data: `data-${string}`]: string | number | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const watched = useRef<{ box: HTMLElement; stop: () => void } | null>(null);
  useEffect(() => {
    const cell = ref.current;
    const box = cell?.querySelector<HTMLElement>(":scope > section > .glass-card, :scope > section > .widget-tiles") ?? null;
    if (watched.current?.box === box) return;
    watched.current?.stop();
    watched.current = null;
    if (!cell || !box) return;
    const heading = cell.querySelector("section h2, section h3")?.textContent?.trim();
    const measure = () => {
      const scrolls = box.scrollHeight > box.clientHeight + 1 && !box.querySelector(FOCUSABLE);
      if (scrolls) {
        box.setAttribute("tabindex", "0");
        box.setAttribute("role", "region");
        box.setAttribute("aria-label", heading || "Scrollable content");
      } else {
        box.removeAttribute("tabindex");
        box.removeAttribute("role");
        box.removeAttribute("aria-label");
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    watched.current = { box, stop: () => ro.disconnect() };
  });
  useEffect(() => () => watched.current?.stop(), []);
  return (
    <div ref={ref} className={className} style={style} {...rest}>
      {children}
    </div>
  );
}
