import type { Metadata } from "next";
import Link from "next/link";
import SettingsControls from "@/components/SettingsControls";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-8 px-6 py-12 sm:px-10 lg:py-16">
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

      <div className="glass-card p-6">
        <SettingsControls />
      </div>

      <Link
        href="/admin"
        className="glass-card flex items-center justify-between p-4 text-sm text-fg/70 transition-colors hover:text-fg"
      >
        Admin portal
        <span aria-hidden>→</span>
      </Link>
    </main>
  );
}
