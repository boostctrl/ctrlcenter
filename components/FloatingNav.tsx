"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useEditMode } from "./EditMode";
import type { NavPages } from "@/lib/nav";

// The floating corner control — the old settings gear, evolved into a small menu
// that links to every enabled page so navigation is reachable from anywhere
// without touching the header. Which admin-gated pages appear is decided
// server-side (see navPages); Help, Settings and the Admin portal always appear,
// and the current page is omitted. With more than one board (#298) the menu
// opens with the board switcher: every board the visitor can open, the
// current one marked; with one, a plain Dashboard link. Closes on outside
// click or Escape.
export default function FloatingNav({ boards, weather, status, calendar }: NavPages) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Present only on the home page (the provider lives there); everywhere else
  // the context defaults to a non-admin, so the edit item never shows.
  const { isAdmin, editing, setEditing } = useEditMode();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const switcher = boards.length > 1;
  const links = (
    [
      switcher ? null : { href: "/", label: "Dashboard" },
      weather ? { href: "/weather", label: "Weather" } : null,
      status ? { href: "/status", label: "Status" } : null,
      calendar ? { href: "/calendar", label: "Calendar" } : null,
      { href: "/help", label: "Help" },
      { href: "/settings", label: "Settings" },
      // Always listed, like on the Settings page — both live under /admin and
      // gate themselves behind its login.
      { href: "/admin/monitor", label: "Monitor" },
      { href: "/admin", label: "Admin portal" },
    ].filter(Boolean) as { href: string; label: string }[]
  ).filter((l) => l.href !== pathname);

  return (
    <div ref={ref} className="fixed right-5 bottom-5 z-40 flex flex-col items-end">
      {open && (
        <nav className="mb-2 flex max-h-[calc(100vh-6rem)] min-w-44 flex-col overflow-y-auto rounded-2xl border border-fg/10 bg-[var(--background)]/90 py-1 shadow-lg backdrop-blur-xl">
          {switcher && (
            <div className="flex flex-col border-b border-fg/10 pb-1" aria-label="Boards" role="group">
              {boards.map((b) =>
                b.href === pathname ? (
                  <span
                    key={b.id}
                    aria-current="page"
                    className="px-4 py-2 text-sm font-medium text-ink-90"
                  >
                    {b.name}
                  </span>
                ) : (
                  <Link
                    key={b.id}
                    href={b.href}
                    onClick={() => setOpen(false)}
                    className="px-4 py-2 text-sm text-ink-70 transition-colors hover:bg-fg/10 hover:text-fg"
                  >
                    {b.name}
                  </Link>
                )
              )}
            </div>
          )}
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="px-4 py-2 text-sm text-ink-70 transition-colors hover:bg-fg/10 hover:text-fg"
            >
              {l.label}
            </Link>
          ))}
          {isAdmin && !editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setOpen(false);
              }}
              className="border-t border-fg/10 px-4 py-2 text-left text-sm text-ink-70 transition-colors hover:bg-fg/10 hover:text-fg"
            >
              Edit layout
            </button>
          )}
        </nav>
      )}
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-fg/10 bg-fg/5 text-ink-60 shadow-lg backdrop-blur-xl transition-colors hover:bg-fg/10 hover:text-fg"
      >
        {open ? (
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        )}
      </button>
    </div>
  );
}
