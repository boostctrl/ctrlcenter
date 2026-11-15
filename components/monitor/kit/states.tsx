// The states an integration's page can be in besides "here's the data"
// (#508): it can't be reached, or it answered with data from before a
// failed refresh. Each fills the page as a designed state, not a stray line.
import Link from "next/link";
import { buttonClasses } from "@/lib/buttons";
import { Glyph } from "./glyphs";
import { STATE_DOT, type ServiceState } from "../state";

// Can't be reached, and nothing to show from before.
export function OfflineState({
  label,
  error,
  settingsHref,
}: {
  label: string;
  error: string | null;
  settingsHref: string;
}) {
  return (
    <section className="glass-card flex flex-col items-center gap-5 px-6 py-16 text-center [--surface-lift:0px]">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-status-down/12 text-status-down">
        <Glyph name="offline" className="h-7 w-7" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold text-ink-90">Can’t reach {label}</h2>
        {error && <p className="font-mono text-xs text-ink-55">{error}</p>}
      </div>
      <p className="max-w-md text-sm text-ink-55">
        This page tries again every 30 seconds. Check that {label} is running, and that its address and
        credentials in Settings are right.
      </p>
      <Link href={settingsHref} className={buttonClasses("ghost", "sm")}>
        Check the settings
      </Link>
    </section>
  );
}

// The last refresh failed; the data shown is from the one before.
export function StaleNotice({ error, since }: { error: string | null; since: string | null }) {
  return (
    <p
      role="status"
      className="flex items-start gap-2.5 rounded-xl border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-sm text-ink-85"
    >
      <span className="mt-0.5 shrink-0 text-status-warning">
        <Glyph name="alert" />
      </span>
      <span>
        Couldn’t refresh{since ? `; showing what came back ${since}` : ""}.
        {error && <span className="text-ink-55"> {error}</span>}
      </span>
    </p>
  );
}

// The status dot, pulsing while data is flowing so the page reads as live
// (stilled with the rest of the app's motion).
export function LiveDot({ state }: { state: ServiceState }) {
  return (
    <span aria-hidden className="relative flex h-2 w-2">
      {state === "live" && (
        <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping ${STATE_DOT[state]}`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${STATE_DOT[state]}`} />
    </span>
  );
}
