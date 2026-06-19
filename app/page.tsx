import Link from "next/link";
import { readConfig } from "@/lib/config";
import Header from "@/components/Header";
import AppCard from "@/components/AppCard";
import BookmarkGroup from "@/components/BookmarkGroup";
import type { BookmarkItem } from "@/lib/schema";

export const dynamic = "force-dynamic";

function groupBookmarks(bookmarks: BookmarkItem[]): [string, BookmarkItem[]][] {
  const map = new Map<string, BookmarkItem[]>();
  for (const bookmark of bookmarks) {
    const list = map.get(bookmark.category) ?? [];
    list.push(bookmark);
    map.set(bookmark.category, list);
  }
  return Array.from(map.entries());
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-5 text-sm font-semibold tracking-[0.2em] text-white/50 uppercase">
      {children}
    </h2>
  );
}

export default async function HomePage() {
  const config = await readConfig();
  const { settings, apps, bookmarks } = config;
  const groups = groupBookmarks(bookmarks);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-12 px-6 py-12 sm:px-10 lg:py-16">
      <Header settings={settings} />

      {apps.length > 0 && (
        <section>
          <SectionTitle>Applications</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {apps.map((app) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        </section>
      )}

      {groups.length > 0 && (
        <section>
          <SectionTitle>Bookmarks</SectionTitle>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map(([category, items]) => (
              <BookmarkGroup key={category} category={category} items={items} />
            ))}
          </div>
        </section>
      )}

      {apps.length === 0 && groups.length === 0 && (
        <p className="text-white/40">
          Nothing here yet.{" "}
          <Link href="/admin" className="underline hover:text-white/70">
            Add your first app or bookmark
          </Link>
          .
        </p>
      )}

      <footer className="mt-auto pt-8 text-center text-xs text-white/30">
        <Link href="/admin" className="transition-colors hover:text-white/60">
          Manage
        </Link>
      </footer>
    </main>
  );
}
