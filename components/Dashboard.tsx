"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppCard from "./AppCard";
import BookmarkGroup from "./BookmarkGroup";
import {
  buildSearchUrl,
  engineLabel,
  resolveBang,
  appBangMap,
  parseBang,
  type SearchConfig,
} from "@/lib/search";
import { orderCategories } from "@/lib/bookmarks";
import { useVisitorPrefs } from "./PrefsProvider";
import type { AppItem, BookmarkItem } from "@/lib/schema";
import type { LayoutSection, LayoutSectionId, SectionWidth } from "@/lib/layout";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-5 text-sm font-semibold tracking-[0.2em] text-fg/60 uppercase">
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
  search,
  categoryOrder = [],
  showSearch = true,
  showApps = true,
  showBookmarks = true,
  showFavorites = true,
  calendar = null,
  layout,
}: {
  apps: AppItem[];
  bookmarks: BookmarkItem[];
  search: SearchConfig;
  categoryOrder?: string[];
  showSearch?: boolean;
  showApps?: boolean;
  showBookmarks?: boolean;
  showFavorites?: boolean;
  // The calendar widget (rendered server-side and passed in); hidden during an
  // active search so results stay adjacent to the input. Passed as null when the
  // widget wouldn't render, so its layout cell isn't left empty.
  calendar?: React.ReactNode;
  // The admin section arrangement (order + width), already resolved. Sections
  // render in this order into a 2-column grid; `full` spans both columns.
  layout: LayoutSection[];
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { favorites } = useVisitorPrefs();

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

  // A leading `!bang` puts the search bar in "command" mode: the query targets a
  // bang destination rather than filtering apps/bookmarks.
  const appBangs = useMemo(
    () =>
      appBangMap(
        apps.map((a) => ({ name: a.name, subtitle: a.subtitle, url: a.url }))
      ),
    [apps]
  );
  const parsedBang = useMemo(() => parseBang(query), [query]);
  const bangHit = useMemo(
    () => resolveBang(query, search.bangs ?? [], appBangs),
    [query, search.bangs, appBangs]
  );

  const filteredApps = useMemo(() => {
    if (!showApps) return [];
    if (!q) return apps;
    return apps.filter((a) =>
      [a.name, a.subtitle, a.url].some((f) => f.toLowerCase().includes(q))
    );
  }, [apps, q, showApps]);

  const filteredGroups = useMemo(() => {
    if (!showBookmarks) return [];
    const matches = !q
      ? bookmarks
      : bookmarks.filter((b) =>
          [b.name, b.category, b.url].some((f) => f.toLowerCase().includes(q))
        );
    return groupBookmarks(matches, categoryOrder);
  }, [bookmarks, q, categoryOrder, showBookmarks]);

  // Pinned apps, in pin order, dropping any that no longer exist. Shown only when
  // not searching — during a search the filtered results take over.
  const favoriteApps = useMemo(() => {
    const byId = new Map(apps.map((a) => [a.id, a]));
    return favorites
      .map((id) => byId.get(id))
      .filter((a): a is AppItem => a !== undefined);
  }, [apps, favorites]);

  // Whether there's anything configured at all (drives the empty-state) vs.
  // anything the admin's left visible to search (drives the search bar/messages).
  const hasAnyContent = apps.length > 0 || bookmarks.length > 0;
  const hasVisibleContent =
    (showApps && apps.length > 0) || (showBookmarks && bookmarks.length > 0);
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

  // Enter: a recognized bang wins, then the top app/bookmark match, then a web
  // search of the query.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !q) return;
    if (bangHit) {
      window.open(bangHit.url, "_blank", "noopener,noreferrer");
      return;
    }
    const top = topResultUrl();
    if (top) {
      window.open(top, "_blank", "noopener,noreferrer");
    } else {
      webSearch();
    }
  }

  // Card grids reflow to fewer columns when their section sits in a half-width
  // column. Complete, static class strings (no interpolation) so Tailwind's
  // extractor keeps every variant.
  const CARD_GRID: Record<SectionWidth, string> = {
    full: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
    half: "grid grid-cols-1 gap-4 sm:grid-cols-2",
  };
  const BOOKMARK_GRID: Record<SectionWidth, string> = {
    full: "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3",
    half: "grid grid-cols-1 gap-6 sm:grid-cols-2",
  };

  // Each movable section as a node for a given width, or null when it shouldn't
  // render right now (hidden, empty, or hidden during an active search). Null
  // blocks are skipped so they leave no gap in the layout grid.
  function blockFor(id: LayoutSectionId, width: SectionWidth): React.ReactNode {
    switch (id) {
      case "search":
        return showSearch && hasVisibleContent ? (
          <div className="relative">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search"
              aria-label="Search applications and bookmarks"
              className="accent-focus w-full rounded-2xl border border-fg/10 bg-fg/[0.04] px-5 py-3.5 text-fg placeholder-fg/30 outline-none backdrop-blur-xl transition-colors"
            />
          </div>
        ) : null;
      case "calendar":
        return !q ? calendar : null;
      case "favorites":
        return showFavorites && !q && favoriteApps.length > 0 ? (
          <section>
            <SectionTitle>Favorites</SectionTitle>
            <div className={CARD_GRID[width]}>
              {favoriteApps.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          </section>
        ) : null;
      case "apps":
        return filteredApps.length > 0 ? (
          <section>
            <SectionTitle>Applications</SectionTitle>
            <div className={CARD_GRID[width]}>
              {filteredApps.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </div>
          </section>
        ) : null;
      case "bookmarks":
        return filteredGroups.length > 0 ? (
          <section>
            <SectionTitle>Bookmarks</SectionTitle>
            <div className={BOOKMARK_GRID[width]}>
              {filteredGroups.map(([category, items]) => (
                <BookmarkGroup key={category} category={category} items={items} />
              ))}
            </div>
          </section>
        ) : null;
      default:
        return null;
    }
  }

  const content = (
    <>
      <div className="grid grid-cols-1 gap-x-8 gap-y-12 lg:grid-cols-2 lg:items-start">
        {layout.map(({ id, width }) => {
          const node = blockFor(id, width);
          if (!node) return null;
          return (
            <div key={id} className={width === "full" ? "lg:col-span-2" : undefined}>
              {node}
            </div>
          );
        })}
      </div>

      {hasVisibleContent && !hasResults && parsedBang && (
        <p className="text-fg/50">
          {bangHit ? (
            <>
              <span className="text-fg/40">↵</span>{" "}
              {bangHit.term
                ? `Search ${bangHit.label} for “${bangHit.term}”`
                : `Open ${bangHit.label}`}
            </>
          ) : (
            <span className="text-fg/40">
              No bang “!{parsedBang.key}”. Press Enter to search the web.
            </span>
          )}
        </p>
      )}

      {hasVisibleContent && !hasResults && !parsedBang && (
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

      {!hasAnyContent && (
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

  return content;
}
