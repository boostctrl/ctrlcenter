"use client";

import { useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
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
import ChangePassword from "./ChangePassword";
import { Button } from "./ui";
import { ToastProvider, useToast } from "./Toast";
import { ConfirmProvider } from "./Confirm";
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
}: Props) {
  const [tab, setTab] = useState<Tab>("apps");
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  async function handleExport() {
    try {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error();
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ctrlcenter-config.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast("Export failed", "error");
    }
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be picked again later
    if (!file) return;
    try {
      const config = JSON.parse(await file.text());
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Manage your dashboard</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="text-sm text-fg/50 transition-colors hover:text-fg/80"
          >
            View site
          </Link>
          <Button variant="ghost" type="button" onClick={handleExport}>
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
            className="hidden"
          />
          <Button variant="ghost" type="button" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-fg/10 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
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
        <div className="space-y-4">
          <SettingsManager initialSettings={initialSettings} />
          <section className="glass-card flex flex-col gap-4 p-5">
            <h3 className="text-xs font-semibold tracking-[0.15em] text-fg/45 uppercase">
              Security
            </h3>
            <ChangePassword />
          </section>
        </div>
      )}
    </div>
  );
}
