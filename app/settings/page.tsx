import type { Metadata } from "next";
import Link from "next/link";
import SettingsControls from "@/components/SettingsControls";
import ThemeBuilder from "@/components/ThemeBuilder";
import BackHome from "@/components/BackHome";
import FloatingNav from "@/components/FloatingNav";
import { readConfig } from "@/lib/config";
import { resolveThemePacks } from "@/lib/theme";
import { buttonClasses } from "@/lib/buttons";
import { navPages } from "@/lib/nav";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { settings, themes } = await readConfig();
  const packs = resolveThemePacks(themes);
  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
      <div>
        <BackHome />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Settings</h1>
            <p className="mt-1 text-sm text-fg/50">
              These preferences are saved in this browser only.{" "}
              <Link
                href="/help"
                className="underline underline-offset-2 hover:text-fg/80"
              >
                Help &amp; shortcuts
              </Link>
            </p>
          </div>
          <Link
            href="/admin"
            className={`${buttonClasses("ghost")} inline-flex shrink-0 items-center gap-2`}
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
      {settings.components.settingsButton && (
        <FloatingNav {...navPages(settings)} />
      )}
    </>
  );
}
