"use client";

import { buttonClasses } from "@/lib/buttons";
import type { Mode } from "../prefs/themeApply";

// A miniature of the dashboard for the mode being edited (#328): the greeting
// with its accent mark, a section label, an app card drawn with the real
// `glass-card` surface (so the design, tune and colors show as they will), a
// status dot, a primary and a ghost button, and text at each ink level. It
// paints with the live CSS variables — the builder previews the edited mode
// on the whole page — so it needs no props beyond the mode's name. Pinned
// beside the tabs on wide screens and above them on a phone, where the live
// page is off-screen while editing.
export function PreviewCard({ mode }: { mode: Mode }) {
  return (
    <div
      aria-label={`Preview of the ${mode} theme`}
      className="rounded-lg border border-fg/10 p-3"
      style={{ background: "color-mix(in srgb, var(--background) 92%, transparent)" }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.15em] text-ink-45 uppercase">
          Preview · {mode}
        </span>
        <span className="text-[10px] text-ink-40">live</span>
      </div>
      <p className="mt-2 text-xl leading-tight font-bold tracking-tight text-fg">
        Good evening<span className="gradient-text">!</span>
      </p>
      <p className="accent-label mt-2 text-[10px] font-semibold tracking-[0.2em] uppercase">
        Applications
      </p>
      <div className="glass-card mt-2 flex items-center gap-3 px-3 py-2.5">
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-fg/5 ring-1 ring-fg/10"
          aria-hidden
        >
          <span
            className="h-4 w-4 rounded-sm"
            style={{
              backgroundImage: "linear-gradient(135deg, var(--accent-from), var(--accent-to))",
            }}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-90">Media Server</span>
          <span className="block truncate text-xs text-ink-55">Jellyfin</span>
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`${buttonClasses("primary", "sm")} pointer-events-none`}>Save</span>
        <span className={`${buttonClasses("ghost", "sm")} pointer-events-none`}>Cancel</span>
      </div>
      <p className="mt-2 text-xs leading-snug">
        <span className="text-ink-90">Primary text, </span>
        <span className="text-ink-60">secondary, </span>
        <span className="text-ink-40">and a hint.</span>
      </p>
    </div>
  );
}
