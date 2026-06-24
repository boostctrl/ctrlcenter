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
        <h1 className="mt-3 text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-fg/50">
          These preferences are saved in this browser only.
        </p>
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
