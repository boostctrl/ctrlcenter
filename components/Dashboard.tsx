"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppCard from "./AppCard";
import BookmarkGroup from "./BookmarkGroup";
import type { AppItem, BookmarkItem } from "@/lib/schema";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-5 text-sm font-semibold tracking-[0.2em] text-white/50 uppercase">
      {children}
    </h2>
  );
}

function groupBookmarks(bookmarks: BookmarkItem[]): [string, BookmarkItem[]][] {
  const map = new Map<string, BookmarkItem[]>();
  for (const bookmark of bookmarks) {
    const list = map.get(bookmark.category) ?? [];
    list.push(bookmark);
    map.set(bookmark.category, list);
  }
  return Array.from(map.entries());
}

export default function Dashboard({
  apps,
  bookmarks,
}: {
  apps: AppItem[];
  bookmarks: BookmarkItem[];
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses search; Escape clears and blurs it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "Escape" && target === inputRef.current) {
        setQuery("");
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const q = query.trim().toLowerCase();

  const filteredApps = useMemo(() => {
    if (!q) return apps;
    return apps.filter((a) =>
      [a.name, a.subtitle, a.url].some((f) => f.toLowerCase().includes(q))
    );
  }, [apps, q]);

  const filteredGroups = useMemo(() => {
    const matches = !q
      ? bookmarks
      : bookmarks.filter((b) =>
          [b.name, b.category, b.url].some((f) => f.toLowerCase().includes(q))
        );
    return groupBookmarks(matches);
  }, [bookmarks, q]);

  const hasContent = apps.length > 0 || bookmarks.length > 0;
  const hasResults = filteredApps.length > 0 || filteredGroups.length > 0;

  return (
    <>
      {hasContent && (
        <div className="relative">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search applications and bookmarks…"
            aria-label="Search applications and bookmarks"
            className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3.5 text-white placeholder-white/30 outline-none backdrop-blur-xl transition-colors focus:border-violet-400/60"
          />
          {!query && (
            <kbd className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/40">
              /
            </kbd>
          )}
        </div>
      )}

      {filteredApps.length > 0 && (
        <section>
          <SectionTitle>Applications</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {filteredApps.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        </section>
      )}

      {filteredGroups.length > 0 && (
        <section>
          <SectionTitle>Bookmarks</SectionTitle>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredGroups.map(([category, items]) => (
              <BookmarkGroup key={category} category={category} items={items} />
            ))}
          </div>
        </section>
      )}

      {hasContent && !hasResults && (
        <p className="text-white/40">No matches for “{query}”.</p>
      )}

      {!hasContent && (
        <p className="text-white/40">
          Nothing here yet.{" "}
          <Link href="/admin" className="underline hover:text-white/70">
            Add your first app or bookmark
          </Link>
          .
        </p>
      )}
    </>
  );
}
