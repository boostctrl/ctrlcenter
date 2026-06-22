"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppCard from "./AppCard";
import BookmarkGroup from "./BookmarkGroup";
import { StatusProvider, StatusSummary } from "./StatusProvider";
import { buildSearchUrl, engineLabel, type SearchConfig } from "@/lib/search";
import { orderCategories } from "@/lib/bookmarks";
import type { AppItem, BookmarkItem } from "@/lib/schema";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-5 text-sm font-semibold tracking-[0.2em] text-fg/50 uppercase">
      {children}
    </h2>
  );
}

function groupBookmarks(
  bookmarks: BookmarkItem[],
  categoryOrder: string[]
): [string, BookmarkItem[]][] {
  const map = new Map<string, BookmarkItem[]>();
  for (const bookmark of bookmarks) {
    const list = map.get(bookmark.category) ?? [];
    list.push(bookmark);
    map.set(bookmark.category, list);
  }
  return orderCategories(Array.from(map.keys()), categoryOrder).map((c) => [
    c,
    map.get(c)!,
  ]);
}

export default function Dashboard({
  apps,
  bookmarks,
  statusEnabled = false,
  search,
  categoryOrder = [],
}: {
  apps: AppItem[];
  bookmarks: BookmarkItem[];
  statusEnabled?: boolean;
  search: SearchConfig;
  categoryOrder?: string[];
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
    return groupBookmarks(matches, categoryOrder);
  }, [bookmarks, q, categoryOrder]);

  const hasContent = apps.length > 0 || bookmarks.length > 0;
  const hasResults = filteredApps.length > 0 || filteredGroups.length > 0;

  function topResultUrl(): string | null {
    if (filteredApps.length > 0) return filteredApps[0].url;
    const firstGroup = filteredGroups[0];
    return firstGroup?.[1][0]?.url ?? null;
  }

  function webSearch() {
    const url = buildSearchUrl(search, query);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  // Enter opens the top match if there is one, otherwise searches the web.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !q) return;
    const top = topResultUrl();
    if (top) {
      window.open(top, "_blank", "noopener,noreferrer");
    } else {
      webSearch();
    }
  }

  const content = (
    <>
      {hasContent && (
        <div className="relative">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search applications and bookmarks…"
            aria-label="Search applications and bookmarks"
            className="accent-focus w-full rounded-2xl border border-fg/10 bg-fg/[0.04] px-5 py-3.5 text-fg placeholder-fg/30 outline-none backdrop-blur-xl transition-colors"
          />
          {!query && (
            <kbd className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 rounded-md border border-fg/10 bg-fg/5 px-2 py-0.5 text-xs text-fg/40">
              /
            </kbd>
          )}
        </div>
      )}

      {filteredApps.length > 0 && (
        <section>
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-[0.2em] text-fg/50 uppercase">
              Applications
            </h2>
            <StatusSummary />
          </div>
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
        <p className="text-fg/40">
          No matches for “{query}”.{" "}
          {buildSearchUrl(search, query) && (
            <button
              type="button"
              onClick={webSearch}
              className="text-fg/60 underline transition-colors hover:text-fg/90"
            >
              Search {engineLabel(search)} for “{query}” →
            </button>
          )}
        </p>
      )}

      {!hasContent && (
        <p className="text-fg/40">
          Nothing here yet.{" "}
          <Link href="/admin" className="underline hover:text-fg/70">
            Add your first app or bookmark
          </Link>
          .
        </p>
      )}
    </>
  );

  // Mount the status poller once (independent of search filtering) whenever the
  // feature is on and there are apps to check.
  return statusEnabled && apps.length > 0 ? (
    <StatusProvider>{content}</StatusProvider>
  ) : (
    content
  );
}
