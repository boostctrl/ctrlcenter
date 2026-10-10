"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type {
  AppItem,
  BookmarkItem,
  Settings,
  Board,
  Group,
  Integration,
  ThemePackConfig,
  WidgetInstance,
} from "@/lib/schema";
import AppsManager from "./AppsManager";
import BookmarksManager from "./BookmarksManager";
import SettingsManager from "./SettingsManager";
import { monitoredApps } from "@/lib/schema";
import ThemesManager from "./ThemesManager";
import PageNav from "@/components/PageNav";
import { useEdgeFade } from "@/components/useEdgeFade";
import { resolveThemePacks } from "@/lib/theme";
import { navPages } from "@/lib/nav";
import { useGroups } from "./useGroups";
import { downloadJson } from "@/lib/download";
import { buttonClasses } from "@/lib/buttons";
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
  initialWidgets: WidgetInstance[];
  initialBoards: Board[];
  initialGroups: Group[];
  initialIntegrations: Integration[];
  initialThemes: ThemePackConfig[];
  initialTwoFactorEnabled: boolean;
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
  initialWidgets,
  initialBoards,
  initialGroups,
  initialIntegrations,
  initialThemes,
  initialTwoFactorEnabled,
  initialTab,
  initialSection,
}: Props) {
  // The groups (#299), shared by the Applications, Bookmarks and Settings
  // tabs, which remount on every switch.
  const groupsState = useGroups(initialGroups);
  // The URL is the initial source of truth (?tab=settings deep-links and
  // survives refresh); an unknown value falls back to the first tab.
  const [tab, setTab] = useState<Tab>(() =>
    TABS.some((t) => t.key === initialTab) ? (initialTab as Tab) : "apps"
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const {
    ref: tabFadeRef,
    onScroll: onTabScroll,
    style: tabFadeStyle,
  } = useEdgeFade<HTMLDivElement>();

  // Keep the active tab in view when the strip scrolls on a phone: a
  // ?tab=settings deep link otherwise opened with its highlighted tab clipped
  // off the right edge (#272).
  useEffect(() => {
    const row = tabFadeRef.current;
    const active = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !active) return;
    const r = row.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (a.left < r.left) row.scrollLeft -= r.left - a.left + 16;
    else if (a.right > r.right) row.scrollLeft += a.right - r.right + 16;
  }, [tab, tabFadeRef]);

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
    // A full load on purpose: it drops the admin's client state and router
    // cache, which a soft router.push would keep alive after sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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
    const noteCount = Array.isArray(c.outageNotes) ? c.outageNotes.length : 0;
    const notesClause =
      noteCount > 0 ? ` It also brings back ${plural(noteCount, "incident note")}.` : "";
    const ok = await confirm({
      title: "Replace the entire configuration?",
      message:
        `This file has ${plural(appCount, "app")} and ` +
        `${plural(bookmarkCount, "bookmark")}${titleClause}. Importing it ` +
        "replaces your entire configuration — apps, bookmarks, settings, " +
        "layout, and themes. Your current configuration is first saved beside " +
        "the config file as config.yaml.bak, so you can restore it." +
        notesClause,
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
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-8xl flex-col gap-8 px-6 pt-12 pb-24 sm:px-10"
    >
      <div>
        {/* The admin portal isn't one of the strip's listed pages (it's a
            gated portal, reachable from the floating menu and /settings), so
            nothing is current here. Flags come from the server-rendered
            settings; a feature toggled this session updates on reload. */}
        <PageNav current={null} {...navPages(
            { settings: initialSettings, boards: initialBoards, widgets: initialWidgets },
            true
          )} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-3xl font-bold">Manage your dashboard</h1>
          {/* A 2×2 grid on phones rather than a wrap that strands "Log out"
              alone on its own row (#272). */}
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3">
            <Link
              href="/admin/monitor"
              className={`${buttonClasses("ghost", "md")} text-center`}
              title="Live status of your connected integrations — admin-only."
            >
              Monitor
            </Link>
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
          viewport; shrink-0 keeps each tab intact instead of squashing, and the
          shared edge fade signals a clipped side (#143). */}
      <div
        ref={tabFadeRef}
        onScroll={onTabScroll}
        style={tabFadeStyle}
        role="tablist"
        aria-label="Admin sections"
        className="flex gap-1 overflow-x-auto border-b border-fg/10 pb-2 sm:gap-2"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => selectTab(t.key)}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
              tab === t.key ? "bg-fg/10 text-fg" : "text-ink-50 hover:text-ink-80"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "apps" && (
        <AppsManager
          initialApps={initialApps}
          groupsState={groupsState}
          statusChecksEnabled={initialSettings.statusChecks}
          statusInterval={initialSettings.statusInterval}
        />
      )}
      {tab === "bookmarks" && (
        <BookmarksManager
          initialBookmarks={initialBookmarks}
          groupsState={groupsState}
        />
      )}
      {tab === "themes" && <ThemesManager initialOverrides={initialThemes} />}
      {tab === "settings" && (
        <SettingsManager
          initialSettings={initialSettings}
          initialWidgets={initialWidgets}
          initialBoards={initialBoards}
          initialIntegrations={initialIntegrations}
          groupsState={groupsState}
          initialApps={initialApps}
          initialBookmarks={initialBookmarks}
          apps={monitoredApps(initialApps).map(({ id, name }) => ({ id, name }))}
          themePacks={resolveThemePacks(initialThemes)}
          initialSection={initialSection}
          initialTwoFactorEnabled={initialTwoFactorEnabled}
        />
      )}
    </main>
  );
}
