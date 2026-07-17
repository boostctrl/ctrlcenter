"use client";

import { useRef } from "react";

// The pencil that swaps a label for an inline rename field. Callers position it
// (absolute over a card, inline beside a heading) via `className`; sharing the
// icon and aria wiring keeps the theme-builder saved-theme cards and the
// bookmark category headings from drifting apart (#144).
export function RenameButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={className}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    </button>
  );
}

// The inline rename input. Enter (or blur) commits the trimmed value; Escape
// cancels, leaving the name untouched. It owns the cancel bookkeeping — the
// blur that follows an Escape-driven unmount must not fire a commit — so callers
// only say what commit and cancel do. No preventDefault dance is needed even
// when a commit opens a confirm dialog (a category merge): the dialog ignores
// the keystroke that opened it (#146).
export function RenameField({
  initialValue,
  onCommit,
  onCancel,
  label,
  className,
  maxLength,
  placeholder,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  label: string;
  className?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  const cancelled = useRef(false);
  return (
    <input
      autoFocus
      defaultValue={initialValue}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        onCommit(e.target.value);
      }}
      className={className}
    />
  );
}
