// The building blocks of an integration's page (#508): stat tiles for the
// headline numbers, section cards, list rows, chips and markers. Every page
// is composed from these, so the nine read as one family: the same type
// scale, spacing, surfaces and status colors, in every design and scheme.
import { useId, type ReactNode } from "react";
import { Glyph, type GlyphName } from "./glyphs";
import { TONE_DOT, TONE_SOFT, TONE_TEXT, type Tone } from "./tone";

// A static surface: the design's card, without the hover lift that marks a
// card as something to click.
const SURFACE = "glass-card [--surface-lift:0px]";

// --- Stats ---

// The row of headline numbers under the page header.
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
  visual,
}: {
  label: string;
  value: ReactNode;
  // A unit set smaller beside the value ("MB/s", "%").
  unit?: string;
  hint?: ReactNode;
  // Colors the value: a count of errors in `down`, say.
  tone?: Tone;
  // A small chart or bar under the number.
  visual?: ReactNode;
}) {
  return (
    <div className={`${SURFACE} flex min-w-0 flex-col gap-1 p-4`}>
      <span className="truncate text-[11px] font-medium tracking-wide text-ink-50 uppercase">{label}</span>
      <span className={`flex items-baseline gap-1 text-2xl font-semibold tracking-tight tabular-nums ${tone ? TONE_TEXT[tone] : "text-ink-90"}`}>
        {value}
        {unit && <span className="text-sm font-medium text-ink-50">{unit}</span>}
      </span>
      {hint && <span className="truncate text-xs text-ink-50">{hint}</span>}
      {visual && <div className="mt-1.5">{visual}</div>}
    </div>
  );
}

// --- Sections ---

// A titled card. `flush` lets a list's rows run edge to edge, their dividers
// included; otherwise the body is padded.
export function Section({
  title,
  count,
  actions,
  description,
  flush = false,
  className = "",
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  description?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${SURFACE} flex min-w-0 flex-col ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={id} className="truncate text-[15px] font-semibold text-ink-90">
            {title}
          </h2>
          {count !== undefined && (
            <span className="rounded-full bg-fg/[0.07] px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-60">
              {count}
            </span>
          )}
        </div>
        {actions}
      </div>
      {description && <p className="-mt-1 px-5 pb-3 text-xs text-ink-50">{description}</p>}
      <div className={flush ? "border-t border-fg/[0.07] pb-1" : "px-5 pb-5"}>{children}</div>
    </section>
  );
}

// --- Lists ---

export function List({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-fg/[0.07]">{children}</ul>;
}

// One row: an optional marker, the name and a line under it, and what sits
// at the right (a time, a chip, a number). `below` takes a progress bar or
// actions across the row's width.
export function Row({
  leading,
  primary,
  secondary,
  trailing,
  below,
  title,
}: {
  leading?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  trailing?: ReactNode;
  below?: ReactNode;
  // The full name, for a primary that may be cut short.
  title?: string;
}) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      {leading && <span className="shrink-0">{leading}</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink-85" title={title}>
          {primary}
        </p>
        {secondary && <p className="mt-0.5 truncate text-xs text-ink-50">{secondary}</p>}
        {below && <div className="mt-2">{below}</div>}
      </div>
      {trailing && (
        <div className="flex shrink-0 flex-col items-end gap-1 text-right text-xs tabular-nums text-ink-55">
          {trailing}
        </div>
      )}
    </li>
  );
}

// The foot of a list cut short: shows the rest, or folds them away again.
export function MoreButton({
  expanded,
  total,
  onToggle,
}: {
  expanded: boolean;
  total: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="w-full border-t border-fg/[0.07] px-5 py-3 text-xs font-medium text-ink-60 transition-colors hover:bg-fg/[0.03] hover:text-ink-85"
    >
      {expanded ? "Show fewer" : `Show all ${total}`}
    </button>
  );
}

// A quiet line in place of a list with nothing in it.
export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="px-5 py-6 text-center text-sm text-ink-50">{children}</p>;
}

// --- Markers ---

export function Dot({ tone, className = "" }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]} ${className}`} />;
}

// A small tinted chip with a word in it: "Imported", "Degraded", "Update".
export function Pill({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONE_SOFT[tone]}`}>
      {children}
    </span>
  );
}

// A row's leading icon in a tinted square.
export function GlyphBubble({ name, tone = "muted" }: { name: GlyphName; tone?: Tone }) {
  return (
    <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${TONE_SOFT[tone]}`}>
      <Glyph name={name} />
    </span>
  );
}

// A row's leading date: the month over the day of the month. Empty until
// mounted, so the viewer's zone decides the day.
export function DateBadge({ at }: { at: number | null }) {
  const d = at === null ? null : new Date(at);
  return (
    <span className="flex h-9 w-9 flex-col items-center justify-center rounded-xl bg-fg/[0.06] leading-none">
      <span className="text-[9px] font-semibold tracking-wide text-ink-50 uppercase">
        {d ? d.toLocaleDateString(undefined, { month: "short" }) : ""}
      </span>
      <span className="mt-0.5 text-sm font-semibold tabular-nums text-ink-85">{d ? d.getDate() : ""}</span>
    </span>
  );
}

// --- Notices ---

const NOTICE_GLYPH: Record<Tone, GlyphName> = {
  down: "error",
  warn: "alert",
  info: "info",
  up: "check",
  muted: "info",
};

// What a service reports about itself (health checks, alerts), most severe
// first, each with its tone's icon and word.
export function Notices({ items }: { items: { tone: Tone; label: string; message: string }[] }) {
  return (
    <ul className="divide-y divide-fg/[0.07]">
      {items.map((n, i) => (
        <li key={`${n.message}-${i}`} className="flex items-start gap-3 px-5 py-3">
          <span className={`mt-0.5 shrink-0 ${TONE_TEXT[n.tone]}`}>
            <Glyph name={NOTICE_GLYPH[n.tone]} />
          </span>
          <p className="min-w-0 flex-1 text-sm text-ink-80">{n.message}</p>
          <Pill tone={n.tone}>{n.label}</Pill>
        </li>
      ))}
    </ul>
  );
}
