"use client";

import type {
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import {
  buttonClasses,
  type ButtonSize,
  type ButtonVariant,
} from "@/lib/buttons";

// The admin form chrome, in one place. The layout rules these primitives
// encode (#180): labels sit ABOVE text/select controls (TextField,
// SelectField, TextArea, NumberField); label-LEFT rows are only for toggles,
// chip groups, and compact numbers (ToggleRow, ControlRow, NumberRow). Short
// fields pair up in a grid at the call site; numeric inputs stay compact.

// Control chrome for the odd inputs the components below don't cover
// (datalist text inputs, datetime-local) — so even those can't drift.
export const controlClasses =
  "accent-focus rounded-lg border border-fg/10 bg-fg/[0.06] px-3 py-2 text-fg placeholder-fg/30 outline-none transition-colors hover:border-fg/25";

// The label above a stacked field, and the heading of a list panel — one
// class so every field name in the portal carries the same weight.
export const fieldLabelClasses = "text-[13px] font-medium text-fg/60";

// The muted explainer under a control or at the end of a card.
export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-fg/40">{children}</p>;
}

export function TextField({
  label,
  hint,
  ...props
}: {
  label: string;
  hint?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className={fieldLabelClasses}>{label}</span>
      <input {...props} className={controlClasses} />
      {hint && <span className="text-xs text-fg/40">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  hint,
  ...props
}: {
  label: string;
  hint?: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className={fieldLabelClasses}>{label}</span>
      {/* The native dropdown arrow differs per OS and disappears into the
          dark surface; draw our own chevron so every select matches. */}
      <span className="relative">
        <select
          {...props}
          className={`${controlClasses} w-full appearance-none pr-9`}
        />
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          fill="none"
          className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-fg/40"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {hint && <span className="text-xs text-fg/40">{hint}</span>}
    </label>
  );
}

export function TextArea({
  label,
  hint,
  mono = false,
  ...props
}: {
  label: string;
  hint?: ReactNode;
  /** Monospace at code size — for markdown/source editors. */
  mono?: boolean;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className={fieldLabelClasses}>{label}</span>
      <textarea
        {...props}
        className={`${controlClasses} leading-relaxed ${
          mono ? "font-mono text-xs" : "text-sm"
        }`}
      />
      {hint && <span className="text-xs text-fg/40">{hint}</span>}
    </label>
  );
}

// Clamped integer input: an unparseable keystroke keeps the previous value,
// anything else clamps into [min, max] — the behavior every hand-rolled
// number field had copied separately.
function clampedChange(
  raw: string,
  min: number,
  max: number,
  onChange: (value: number) => void
) {
  const v = parseInt(raw, 10);
  if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
}

// Stacked (label above) number field, for grid layouts beside text fields.
export function NumberField({
  label,
  hint,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className={fieldLabelClasses}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => clampedChange(e.target.value, min, max, onChange)}
        className={controlClasses}
      />
      {hint && <span className="text-xs text-fg/40">{hint}</span>}
    </label>
  );
}

// Label-left row with a compact number input — for "Entries to show"-style
// counts that don't deserve a full-width control.
export function NumberRow({
  label,
  hint,
  min,
  max,
  value,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm">
      <span className="text-fg/70">
        {label}
        {hint && <span className="block text-xs text-fg/40">{hint}</span>}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => clampedChange(e.target.value, min, max, onChange)}
        className={`${controlClasses} w-20 shrink-0 text-center`}
      />
    </label>
  );
}

// The on/off control: an accent-filled sliding switch, not a native checkbox.
// Renders no <label> of its own — compose it inside one (ToggleRow, a card
// header) so the whole row stays clickable; `label` is the accessible name.
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="h-5 w-9 rounded-full bg-fg/20 transition-colors peer-checked:[background-image:linear-gradient(135deg,var(--accent-from),var(--accent-to))] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent-from)] peer-focus-visible:ring-offset-1"
      />
      <span
        aria-hidden
        className="absolute top-1/2 left-0.5 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4"
      />
    </span>
  );
}

// Label-left row with a switch on the right.
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
      <span className="text-fg/70">
        {label}
        {hint && <span className="block text-xs text-fg/40">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  );
}

// Label-left row for a non-checkbox control (chip group, inline select). A
// div, not a label: the control carries its own accessible name.
export function ControlRow({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <div className="text-fg/70">
        {label}
        {hint && <p className="text-xs text-fg/40">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ref,
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      ref={ref}
      className={`${buttonClasses(variant, size)} ${className}`}
    />
  );
}

// The "+ Add …" action under an editable list — the compact ghost button,
// left-aligned so it reads as part of the list it extends.
export function AddButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button variant="ghost" size="sm" className="self-start" onClick={onClick}>
      {children}
    </Button>
  );
}

// The ✕ that removes one row of an editable list.
export function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="shrink-0 rounded-md px-2 py-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-red-400"
    >
      ✕
    </button>
  );
}

// Bordered sub-card for one entry of an editable list that's too rich for a
// single row (announcement entries; the apps/bookmarks rows use the same
// surface).
export const subCardClasses = "rounded-xl border border-fg/10 bg-fg/[0.03]";

// One settings card: a glass surface with an anchored, deep-linkable id
// (#settings-card-…), an eyebrow title, optional intro, and — for cards that
// are a feature with an on/off switch — an enable toggle in the header, so
// every card shares one shape instead of hand-rolling its own header row.
export function Card({
  title,
  intro,
  toggle,
  children,
}: {
  title: string;
  intro?: ReactNode;
  toggle?: { checked: boolean; onChange: (checked: boolean) => void };
  children?: ReactNode;
}) {
  const id =
    "settings-card-" +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  return (
    <section id={id} className="glass-card flex flex-col gap-4 p-5">
      {/* The header underlines itself only when a body follows — a disabled
          feature card is just its header, and a rule over nothing looks
          broken. */}
      <div className="flex items-start justify-between gap-4 [&:not(:only-child)]:border-b [&:not(:only-child)]:border-fg/10 [&:not(:only-child)]:pb-4">
        <div>
          <h3 className="text-[15px] leading-snug font-semibold text-fg/90">
            {title}
          </h3>
          {intro && <p className="mt-1 text-[13px] text-fg/45">{intro}</p>}
        </div>
        {toggle && (
          <label className="flex shrink-0 cursor-pointer items-center pt-0.5">
            <Switch
              checked={toggle.checked}
              onChange={toggle.onChange}
              label={`${title} enabled`}
            />
          </label>
        )}
      </div>
      {children}
    </section>
  );
}

// Bordered panel grouping an editable list's rows and its "+ Add" action into
// one visual unit, instead of rows floating loose in the card.
export function ListPanel({
  label,
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className={fieldLabelClasses}>{label}</span>}
      <div className={`${subCardClasses} flex flex-col gap-2 p-3`}>
        {children}
      </div>
    </div>
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
