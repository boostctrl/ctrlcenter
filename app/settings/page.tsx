import type { Metadata } from "next";
import Link from "next/link";
import SettingsControls from "@/components/SettingsControls";
import ThemeBuilder from "@/components/ThemeBuilder";
import { getThemeOverrides } from "@/lib/config";
import { resolveThemePacks } from "@/lib/theme";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const packs = resolveThemePacks(await getThemeOverrides());
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-fg/50 transition-colors hover:text-fg/80"
        >
          ← Back to dashboard
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="mt-1 text-sm text-fg/50">
              These preferences are saved in this browser only.
            </p>
          </div>
          <Link
            href="/admin"
            className="btn-accent inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-black shadow-sm transition-opacity hover:opacity-90"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Admin portal
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="glass-card p-6">
          <SettingsControls />
        </div>

        <div className="glass-card p-6">
          <ThemeBuilder packs={packs} />
        </div>
      </div>
    </main>
  );
}
