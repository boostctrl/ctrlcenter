"use client";

import type { InputHTMLAttributes, ButtonHTMLAttributes } from "react";
import { buttonClasses, type ButtonVariant } from "@/lib/buttons";

export function TextField({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-fg/50">{label}</span>
      <input
        {...props}
        className="accent-focus rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg placeholder-fg/30 outline-none transition-colors"
      />
    </label>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`${buttonClasses(variant)} ${className}`} />
  );
}

// Keyboard- and touch-accessible reorder controls. HTML5 drag-and-drop doesn't
// work on touch and isn't reachable by keyboard, so these buttons (which call
// the same reorder logic) are the primary, universal way to reorder a list.
//
// `flow` is for 2-D flow grids (the layout editor), where "up" is really
// "earlier in the flow" — on a row of side-by-side cards the same move goes
// LEFT, so the labels say earlier/later and on lg+ (where rows happen) the
// pair turns into horizontal ◀ ▶.
export function MoveButtons({
  index,
  count,
  label,
  onMove,
  flow = false,
}: {
  index: number;
  count: number;
  label: string;
  onMove: (from: number, to: number) => void;
  flow?: boolean;
}) {
  // On coarse pointers these are the ONLY reorder path (HTML5 drag needs a
  // mouse), so they grow toward the touch-target guideline there (#102).
  const btn =
    "flex h-4 w-5 items-center justify-center rounded text-[10px] leading-none text-fg/55 select-none hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-20 pointer-coarse:h-9 pointer-coarse:w-9 pointer-coarse:text-sm";
  const prevLabel = flow ? `Move ${label} earlier` : `Move ${label} up`;
  const nextLabel = flow ? `Move ${label} later` : `Move ${label} down`;
  return (
    <div
      className={`flex shrink-0 flex-col gap-0.5 ${flow ? "lg:flex-row" : ""}`}
    >
      <button
        type="button"
        aria-label={prevLabel}
        title={flow ? prevLabel : undefined}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
        className={btn}
      >
        {flow ? (
          <>
            <span className="lg:hidden">▲</span>
            {/* The small triangles (U+25C2/U+25B8) have no emoji presentation,
                unlike ◀/▶ which Chromium renders as orange emoji. */}
            <span className="hidden lg:inline">◂</span>
          </>
        ) : (
          "▲"
        )}
      </button>
      <button
        type="button"
        aria-label={nextLabel}
        title={flow ? nextLabel : undefined}
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
        className={btn}
      >
        {flow ? (
          <>
            <span className="lg:hidden">▼</span>
            <span className="hidden lg:inline">▸</span>
          </>
        ) : (
          "▼"
        )}
      </button>
    </div>
  );
}

// Row badge for items flagged "Only show when logged in". Shared by the app
// and bookmark managers so the two lists can't drift apart.
export function PrivateChip() {
  return (
    <span
      className="shrink-0 rounded-full border border-fg/15 px-2 py-0.5 text-[10px] font-normal tracking-wide text-fg/45 uppercase"
      title="Only shown when logged in"
    >
      Private
    </span>
  );
}

// The matching form control. The hint differs per item kind (apps are still
// monitored while hidden; bookmarks just disappear), so callers supply it.
export function PrivateToggle({
  checked,
  onChange,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between gap-4 text-sm">
        <span className="text-fg/70">Only show when logged in</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
      <p className="text-xs text-fg/40">{hint}</p>
    </div>
  );
}

// The ⠿ handle that starts a drag-reorder; spread a useReorder `grip(index)`
// onto it. MoveButtons' mouse-only sibling: hidden below sm, where touch rules
// and the buttons are the reorder path. One component so the three reorderable
// lists (apps, bookmarks, category headings) can't drift apart.
export function DragGrip(props: React.ComponentProps<"span">) {
  return (
    <span
      className="hidden cursor-grab text-fg/30 select-none active:cursor-grabbing sm:inline"
      aria-hidden
      title="Drag to reorder"
      {...props}
    >
      ⠿
    </span>
  );
}
