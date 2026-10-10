"use client";

// The layout editor's add-widget palette (#303): every widget type from the
// registry with what it shows. Picking one creates it (with its defaults)
// and the editor places it and opens its settings beside the page.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WIDGET_DEFS } from "@/lib/widgets/defs";
import type { WidgetType } from "@/lib/layout";

export default function WidgetPalette({
  onAdd,
  className = "",
}: {
  // Resolves to an error message, or null once it's placed.
  onAdd: (type: WidgetType) => Promise<string | null>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<WidgetType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Where the popover sits on large screens: above its button. It renders in
  // a portal, clear of the editor bar (whose blur would otherwise contain it
  // and whose phone row scrolls sideways).
  const [pos, setPos] = useState({ left: 0, bottom: 0 });

  // Close on Escape (back to the button) and on a click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !popRef.current?.contains(t))
        setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  async function add(type: WidgetType) {
    setBusy(type);
    setError(null);
    const failed = await onAdd(type);
    setBusy(null);
    if (failed) setError(failed);
    else setOpen(false);
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        // Where focus goes when a removed widget leaves no card behind (#318).
        data-widget-palette-button
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({
            left: r.left + r.width / 2,
            bottom: window.innerHeight - r.top + 12,
          });
          setError(null);
          setOpen((o) => !o);
        }}
        className="shrink-0 rounded-full border border-fg/10 bg-fg/5 px-3 py-1.5 text-sm text-ink-80 transition-colors hover:bg-fg/10"
      >
        Add widget
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            data-widget-palette
            data-editor-keep
            role="dialog"
            aria-label="Add a widget"
            style={
              {
                "--pop-left": `${pos.left}px`,
                "--pop-bottom": `${pos.bottom}px`,
              } as React.CSSProperties
            }
            className="fixed inset-x-3 bottom-36 z-[50] max-h-[60vh] overflow-y-auto rounded-2xl border border-fg/10 bg-[var(--background)] p-3 shadow-2xl lg:inset-x-auto lg:bottom-[var(--pop-bottom)] lg:left-[var(--pop-left)] lg:w-[34rem] lg:-translate-x-1/2"
          >
            <p className="px-1 pb-2 text-xs text-ink-60">
              It goes after the selected card (or at the end), and its settings
              open beside the page.
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {WIDGET_DEFS.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => add(d.id as WidgetType)}
                    className="flex w-full flex-col items-start gap-0.5 rounded-xl border border-fg/10 px-3 py-2 text-left transition-colors hover:bg-fg/5 disabled:opacity-50"
                  >
                    <span className="text-sm font-medium text-ink-90">
                      {busy === d.id ? "Adding…" : d.label}
                    </span>
                    <span className="text-xs text-ink-60">{d.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
            {error && (
              <p role="alert" className="px-1 pt-2 text-xs text-status-down">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
