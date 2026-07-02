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
export function MoveButtons({
  index,
  count,
  label,
  onMove,
}: {
  index: number;
  count: number;
  label: string;
  onMove: (from: number, to: number) => void;
}) {
  const btn =
    "flex h-4 w-5 items-center justify-center rounded text-[10px] leading-none text-fg/40 hover:bg-fg/10 hover:text-fg disabled:pointer-events-none disabled:opacity-20";
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <button
        type="button"
        aria-label={`Move ${label} up`}
        disabled={index === 0}
        onClick={() => onMove(index, index - 1)}
        className={btn}
      >
        ▲
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        disabled={index === count - 1}
        onClick={() => onMove(index, index + 1)}
        className={btn}
      >
        ▼
      </button>
    </div>
  );
}
