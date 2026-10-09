"use client";

import Icon from "./Icon";
import { StatusDot } from "./StatusProvider";
import { useFavorites } from "./PrefsProvider";
import type { AppItem } from "@/lib/schema";

// `top` marks the search's top match — the card Enter opens — with the same
// ring keyboard focus uses (#274).
export default function AppCard({ app, top = false }: { app: AppItem; top?: boolean }) {
  const { favorites, toggleFavorite } = useFavorites();
  const favorited = favorites.includes(app.id);

  return (
    // The whole card is clickable via a "stretched link" (the name's <a> with an
    // ::after overlay), so the star button can be a real, separately-clickable
    // button without nesting interactive content inside an anchor.
    <div
      className={`glass-card group relative flex items-center gap-4 px-5 py-4 ${
        top ? "outline-2 outline-offset-2 outline-[color:var(--scene-from)]" : ""
      }`}
    >
      <StatusDot id={app.id} />
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fg/5 ring-1 ring-fg/10">
        <Icon icon={app.icon} name={app.name} size={26} />
      </div>
      <div className="min-w-0 flex-1">
        {/* Two lines before ellipsizing: the column ladder keeps tiles wide
            enough for most names, and wrapping absorbs the rest, so a name
            like "Password Manager" never shows as "Passw…" (#145). */}
        {/* Focus rings the whole card (via the stretched ::after), not just
            the name. P pins or unpins the focused card: the pin button is out
            of the Tab order so each card costs one stop, not two (#274). */}
        <a
          href={app.url}
          target="_blank"
          rel="noreferrer"
          aria-keyshortcuts="P"
          onKeyDown={(e) => {
            if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) {
              e.preventDefault();
              toggleFavorite(app.id);
            }
          }}
          className="line-clamp-2 break-words font-semibold text-ink-90 outline-none after:absolute after:inset-0 after:rounded-[var(--surface-radius)] group-hover:text-fg focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[color:var(--scene-from)]"
        >
          {app.name}
        </a>
        {app.subtitle && (
          <p className="truncate text-sm text-ink-55">{app.subtitle}</p>
        )}
      </div>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => toggleFavorite(app.id)}
        aria-pressed={favorited}
        aria-label={favorited ? `Unpin ${app.name}` : `Pin ${app.name} to favorites`}
        title={favorited ? "Unpin" : "Pin to favorites"}
        style={favorited ? { color: "var(--accent-from)" } : undefined}
        className={`relative z-10 shrink-0 rounded-md p-1 transition hover:bg-fg/10 ${
          favorited
            ? "opacity-100"
            : "text-ink-35 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:text-ink-70"
        }`}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill={favorited ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      </button>
    </div>
  );
}
