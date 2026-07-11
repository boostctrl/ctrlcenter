"use client";

import Icon from "./Icon";
import { StatusDot } from "./StatusProvider";
import { useVisitorPrefs } from "./PrefsProvider";
import type { AppItem } from "@/lib/schema";

export default function AppCard({ app }: { app: AppItem }) {
  const { favorites, toggleFavorite } = useVisitorPrefs();
  const favorited = favorites.includes(app.id);

  return (
    // The whole card is clickable via a "stretched link" (the name's <a> with an
    // ::after overlay), so the star button can be a real, separately-clickable
    // button without nesting interactive content inside an anchor.
    <div className="glass-card group relative flex items-center gap-4 px-5 py-4">
      <StatusDot id={app.id} />
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fg/5 ring-1 ring-fg/10">
        <Icon icon={app.icon} name={app.name} size={26} />
      </div>
      <div className="min-w-0 flex-1">
        {/* Two lines before ellipsizing: the column ladder keeps tiles wide
            enough for most names, and wrapping absorbs the rest, so a name
            like "Password Manager" never shows as "Passw…" (#145). */}
        <a
          href={app.url}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 break-words font-semibold text-fg/90 outline-none after:absolute after:inset-0 after:rounded-[inherit] group-hover:text-fg focus-visible:underline"
        >
          {app.name}
        </a>
        {app.subtitle && (
          <p className="truncate text-sm text-fg/55">{app.subtitle}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => toggleFavorite(app.id)}
        aria-pressed={favorited}
        aria-label={favorited ? `Unpin ${app.name}` : `Pin ${app.name} to favorites`}
        title={favorited ? "Unpin" : "Pin to favorites"}
        style={favorited ? { color: "var(--accent-from)" } : undefined}
        className={`relative z-10 shrink-0 rounded-md p-1 transition hover:bg-fg/10 ${
          favorited
            ? "opacity-100"
            : "text-fg/35 opacity-0 hover:text-fg/70 group-hover:opacity-100 focus-visible:opacity-100"
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
