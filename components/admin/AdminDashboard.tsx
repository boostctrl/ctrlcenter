"use client";

import { useState } from "react";
import Link from "next/link";
import type { AppItem, BookmarkItem, Settings } from "@/lib/schema";
import AppsManager from "./AppsManager";
import BookmarksManager from "./BookmarksManager";
import SettingsManager from "./SettingsManager";
import { Button } from "./ui";

type Tab = "apps" | "bookmarks" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "apps", label: "Applications" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "settings", label: "Settings" },
];

export default function AdminDashboard({
  initialApps,
  initialBookmarks,
  initialSettings,
}: {
  initialApps: AppItem[];
  initialBookmarks: BookmarkItem[];
  initialSettings: Settings;
}) {
  const [tab, setTab] = useState<Tab>("apps");

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12 sm:px-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Manage your homepage</h1>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-white/50 transition-colors hover:text-white/80">
            View site
          </Link>
          <Button variant="ghost" type="button" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-white/10 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "apps" && <AppsManager initialApps={initialApps} />}
      {tab === "bookmarks" && <BookmarksManager initialBookmarks={initialBookmarks} />}
      {tab === "settings" && <SettingsManager initialSettings={initialSettings} />}
    </div>
  );
}
