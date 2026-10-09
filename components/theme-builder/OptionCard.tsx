"use client";

import type { CSSProperties, ReactNode } from "react";

// The card box shared by every option tile and by its rename state, so a shell
// restyle (padding, radius, gap) can't leave one behind (#144).
const CARD_SHELL = "flex w-full flex-col gap-1.5 rounded-lg border p-2";

// The shared shape of every option tile: swatch on top (children), name +
// optional description below, an optional corner badge, and an accent check
// when it's the active choice. Options that are one-shot actions rather than
// state (packs, palettes) simply omit `selected`. Pass `editingField` to render
// the same shell as a non-interactive card with an inline rename input where the
// name would be — an input can't live inside the tile's <button> (#144).
export function OptionCard({
  onClick,
  name,
  selected,
  desc,
  title,
  badge,
  nameStyle,
  children,
  editingField,
}: {
  onClick?: () => void;
  name: string;
  selected?: boolean;
  desc?: string;
  title?: string;
  badge?: string;
  nameStyle?: CSSProperties;
  children: ReactNode;
  editingField?: ReactNode;
}) {
  if (editingField) {
    return (
      <div className={`${CARD_SHELL} border-fg/10`}>
        {children}
        {editingField}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={`group relative ${CARD_SHELL} text-left transition-colors ${
        selected ? "border-[color:var(--accent-from)]" : "border-fg/10 hover:border-fg/30"
      }`}
    >
      {children}
      <span className="min-w-0">
        <span
          className={`block truncate text-xs ${
            selected ? "text-ink-90" : "text-ink-60 group-hover:text-ink-90"
          }`}
          style={nameStyle}
        >
          {name}
        </span>
        {desc && (
          <span className="block truncate text-[10px] text-ink-40">{desc}</span>
        )}
      </span>
      {badge && (
        <span className="absolute top-1 right-1 rounded bg-fg/15 px-1 text-[9px] font-medium tracking-wide text-ink-70 uppercase">
          {badge}
        </span>
      )}
      {selected && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--accent-from)] text-[color:var(--accent-fg)] shadow-sm">
          <svg
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2.5 6.5 5 9l4.5-6" />
          </svg>
        </span>
      )}
    </button>
  );
}
