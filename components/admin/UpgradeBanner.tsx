"use client";

// The one-time "upgraded to 3.0" banner on the admin page (#306): what the
// upgrade did with the 2.x config, where things moved, how to roll back, and
// a link to the full notes. Shown until dismissed.
import { useState } from "react";
import type { UpgradeSummary } from "@/lib/config/upgrade";
import { Button } from "./ui";

export const UPGRADE_NOTES_URL = "https://github.com/boostctrl/ctrlcenter#upgrading-to-30";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function UpgradeBanner({ notice }: { notice: UpgradeSummary }) {
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  async function dismiss() {
    try {
      const res = await fetch("/api/upgrade-notice", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setOpen(false);
    } catch {
      setError("Couldn't dismiss it — try again.");
    }
  }

  return (
    <section
      aria-labelledby="upgrade-banner-title"
      className="glass-card flex flex-col gap-3 border border-violet-400/40 p-5"
    >
      <h2 id="upgrade-banner-title" className="text-lg font-semibold">
        Welcome to CtrlCenter 3.0
      </h2>
      <p className="text-sm text-ink-70">Your configuration was upgraded on first start. What changed:</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink-70">
        <li>
          Your home page layout is now the <strong>Home</strong> board — add more boards in Settings → Layout.
        </li>
        <li>
          Your widgets are now {plural(notice.widgets, "separate widget")} you can add more of, each with its own
          content (Settings → Widgets, or <strong>Add widget</strong> in the layout editor).
        </li>
        {notice.groups > 0 && (
          <li>Your bookmark categories are now {plural(notice.groups, "group")} that apps can join too.</li>
        )}
        {notice.integrations > 0 && (
          <li>
            Your connected services are now {plural(notice.integrations, "integration")} in Settings →
            Integrations, and you can add more than one of a kind. Their environment variables still work.
          </li>
        )}
      </ul>
      <p className="text-sm text-ink-60">
        The 2.x file is kept beside the config as <code>{notice.backup}</code>. To go back, restore it as{" "}
        <code>config.yaml</code> and run the <code>:2.13</code> image — 2.x can&apos;t read a 3.0 config.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a href={UPGRADE_NOTES_URL} target="_blank" rel="noopener noreferrer" className="text-sm text-ink-80 underline">
          Read the upgrade notes
        </a>
        <Button variant="ghost" type="button" onClick={dismiss}>
          Dismiss
        </Button>
        {error && (
          <span role="alert" className="text-sm text-status-down">
            {error}
          </span>
        )}
      </div>
    </section>
  );
}
