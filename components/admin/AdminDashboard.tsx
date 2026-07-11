"use client";

import { useRef, useState, type ChangeEvent } from "react";
import type {
  AppItem,
  BookmarkItem,
  Settings,
  ThemePackConfig,
} from "@/lib/schema";
import AppsManager from "./AppsManager";
import BookmarksManager from "./BookmarksManager";
import SettingsManager from "./SettingsManager";
import ThemesManager from "./ThemesManager";
import BackHome from "@/components/BackHome";
import { resolveThemePacks } from "@/lib/theme";
import { downloadJson } from "@/lib/download";
import { Button } from "./ui";
import { ToastProvider, useToast } from "./Toast";
import { ConfirmProvider, useConfirm } from "./Confirm";
import { replaceUrlParams } from "./urlState";
import { apiErrorMessage } from "./apiError";

type Tab = "apps" | "bookmarks" | "themes" | "settings";

const TABS: { key: Tab; label: string }[] = [
  { key: "apps", label: "Applications" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "themes", label: "Themes" },
  { key: "settings", label: "Settings" },
];

type Props = {
  initialApps: AppItem[];
  initialBookmarks: BookmarkItem[];
  initialSettings: Settings;
  initialThemes: ThemePackConfig[];
  // The ?tab / ?section deep-link params, read server-side by the page (NOT
  // useSearchParams here — that would demand a Suspense boundary whose
  // streamed segment can be left orphaned in the DOM). Unvalidated strings;
  // unknown values fall back to the defaults.
  initialTab?: string;
  initialSection?: string;
};

export default function AdminDashboard(props: Props) {
  // ToastProvider wraps the body so every child (including managers) can call
  // useToast(); the body itself must live inside it to do the same.
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AdminBody {...props} />
      </ConfirmProvider>
    </ToastProvider>
  );
}

function AdminBody({
  initialApps,
  initialBookmarks,
  initialSettings,
  initialThemes,
  initialTab,
  initialSection,
}: Props) {
  // The URL is the initial source of truth (?tab=settings deep-links and
  // survives refresh); an unknown value falls back to the first tab.
  const [tab, setTab] = useState<Tab>(() =>
    TABS.some((t) => t.key === initialTab) ? (initialTab as Tab) : "apps"
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();

  function selectTab(next: Tab) {
    setTab(next);
    replaceUrlParams((params) => {
      params.set("tab", next);
      // `section` belongs to the settings tab alone.
      if (next !== "settings") params.delete("section");
    });
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  async function handleExport() {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error();
      downloadJson("ctrlcenter-config.json", await res.json());
    } catch {
      toast("Export failed", "error");
    }
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    let config: unknown;
    try {
      config = JSON.parse(await file.text());
    } catch {
      toast("Couldn't read that file", "error");
      return;
    }

    // Import swaps everything at once, so confirm first with a lenient summary
    // of the picked file. The server does the real validation; this only reads
    // the file defensively to preview it, falling back gracefully on anything
    // odd (bad JSON never reaches here — it was caught above).
    const c = (config ?? {}) as Record<string, unknown>;
    const appCount = Array.isArray(c.apps) ? c.apps.length : 0;
    const bookmarkCount = Array.isArray(c.bookmarks) ? c.bookmarks.length : 0;
    const settings = (c.settings ?? {}) as Record<string, unknown>;
    const title =
      typeof settings.title === "string" ? settings.title.trim() : "";
    const plural = (n: number, word: string) =>
      `${n} ${word}${n === 1 ? "" : "s"}`;
    const titleClause = title ? ` and sets the title to “${title}”` : "";
    const ok = await confirm({
      title: "Replace the entire configuration?",
      message:
        `This file has ${plural(appCount, "app")} and ` +
        `${plural(bookmarkCount, "bookmark")}${titleClause}. Importing it ` +
        "replaces your entire configuration — apps, bookmarks, settings, " +
        "layout, and themes. Your current configuration is first saved beside " +
        "the config file as config.yaml.bak, so you can restore it.",
      confirmLabel: "Replace configuration",
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(apiErrorMessage(data, "Import failed"), "error");
        return;
      }
      toast("Config imported — reloading…");
      setTimeout(() => window.location.reload(), 700);
    } catch {
      toast("Couldn't read that file", "error");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-8xl flex-col gap-8 px-6 py-12 sm:px-10">
      <div>
        <BackHome />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">Manage your dashboard</h1>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="ghost"
              type="button"
              onClick={handleExport}
              title="Downloads the configuration — uploaded icons included — as a single JSON file."
            >
              Export
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => fileRef.current?.click()}
            >
              Import
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              aria-label="Import configuration file"
              className="hidden"
            />
            <Button variant="ghost" type="button" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>
      </div>

      {/* The row scrolls (not the page) when the tabs outgrow a phone-width
          viewport; shrink-0 keeps each tab intact instead of squashing. */}
      <div className="flex gap-2 overflow-x-auto border-b border-fg/10 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => selectTab(t.key)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-fg/10 text-fg" : "text-fg/50 hover:text-fg/80"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "apps" && <AppsManager initialApps={initialApps} />}
      {tab === "bookmarks" && (
        <BookmarksManager
          initialBookmarks={initialBookmarks}
          initialCategoryOrder={initialSettings.bookmarkCategoryOrder}
        />
      )}
      {tab === "themes" && <ThemesManager initialOverrides={initialThemes} />}
      {tab === "settings" && (
        <SettingsManager
          initialSettings={initialSettings}
          themePacks={resolveThemePacks(initialThemes)}
          initialSection={initialSection}
        />
      )}
    </div>
  );
}
