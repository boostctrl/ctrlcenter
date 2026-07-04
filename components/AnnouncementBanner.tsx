"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { parseInline, type InlineToken } from "@/lib/markdown";
import type { AnnouncementTone } from "@/lib/schema";

// Site-wide announcement strip, rendered at the top of every page from the root
// layout when the admin turns it on. The message is a safe inline-markdown
// subset (bold/italic/links) parsed to tokens and rendered as React elements —
// never injected as HTML. A visitor can dismiss it when `dismissible`; the
// dismissal is remembered per-browser and cleared automatically when the admin
// changes the message (the stored marker is the message itself).

const DISMISS_KEY = "ctrlcenter:announcement";

// Per-tone tint + accent color. Backgrounds are set inline (translucent so they
// read on both light and dark surfaces; the accent tone follows the theme).
const TONE: Record<AnnouncementTone, { bg: string; color: string }> = {
  info: { bg: "rgba(56,189,248,0.12)", color: "#38bdf8" },
  warning: { bg: "rgba(251,191,36,0.14)", color: "#f59e0b" },
  success: { bg: "rgba(52,211,153,0.13)", color: "#10b981" },
  accent: {
    bg: "color-mix(in srgb, var(--accent-from) 14%, transparent)",
    color: "var(--accent-from)",
  },
};

// Small tone glyphs (lucide paths), colored by the tone.
const ICON: Record<AnnouncementTone, React.ReactNode> = {
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  warning: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  accent: (
    <>
      <path d="m3 11 18-5v12L3 14v-3z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </>
  ),
};

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return tokens.map((t, i) => {
    switch (t.kind) {
      case "text":
        return <Fragment key={i}>{t.text}</Fragment>;
      case "break":
        return " ";
      case "code":
        return (
          <code key={i} className="rounded bg-fg/10 px-1 py-0.5 font-mono text-[0.9em]">
            {t.text}
          </code>
        );
      case "bold":
        return (
          <strong key={i} className="font-semibold">
            <Inline tokens={t.children} />
          </strong>
        );
      case "italic":
        return (
          <em key={i}>
            <Inline tokens={t.children} />
          </em>
        );
      case "link":
        return (
          <a
            key={i}
            href={t.href}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline decoration-fg/40 underline-offset-2 transition-colors hover:decoration-fg"
          >
            <Inline tokens={t.children} />
          </a>
        );
    }
  });
}

export default function AnnouncementBanner({
  message,
  tone,
  dismissible,
}: {
  message: string;
  tone: AnnouncementTone;
  dismissible: boolean;
}) {
  // Collapse to a single line — the banner is a strip, not a paragraph.
  const text = useMemo(() => message.replace(/\s+/g, " ").trim(), [message]);
  const tokens = useMemo(() => parseInline(text), [text]);
  const [dismissed, setDismissed] = useState(false);

  // Re-hide on mount if this exact message was already dismissed. Starts false
  // so SSR and the first client render agree (no hydration mismatch); a visitor
  // who dismissed it sees at most one frame before this effect hides it.
  useEffect(() => {
    // Syncing from an external store (localStorage) on mount; a one-time set is
    // the intended behavior here, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (dismissible && localStorage.getItem(DISMISS_KEY) === text) setDismissed(true);
  }, [dismissible, text]);

  if (text === "" || dismissed) return null;

  const { bg, color } = TONE[tone];
  return (
    <div className="border-b border-fg/10" style={{ background: bg }} role="status">
      <div className="mx-auto flex max-w-8xl items-center gap-3 px-6 py-2.5 sm:px-10">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
          style={{ color }}
          aria-hidden
        >
          {ICON[tone]}
        </svg>
        <p className="min-w-0 flex-1 text-sm text-fg/85">
          <Inline tokens={tokens} />
        </p>
        {dismissible && (
          <button
            type="button"
            onClick={() => {
              localStorage.setItem(DISMISS_KEY, text);
              setDismissed(true);
            }}
            aria-label="Dismiss announcement"
            className="-mr-1 shrink-0 rounded-md p-1 text-fg/40 transition-colors hover:bg-fg/10 hover:text-fg/80"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
