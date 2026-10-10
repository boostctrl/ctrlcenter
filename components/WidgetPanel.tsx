"use client";

// The layout editor's widget settings panel (#303): one widget's content,
// edited in place beside the board — the same editor as Settings → Widgets —
// in a side panel on large screens and a bottom sheet on small ones. Loaded
// on demand (next/dynamic), so visitors never download the editors.
//
// It loads the widget as stored (GET /api/widgets/[id]: the board page only
// has the redacted copy, and saving that would wipe its secrets), autosaves
// just that widget (PUT /api/widgets/[id]), and after each save asks the page
// to refresh its data so the card shows the change.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WidgetInstance } from "@/lib/schema";
import type { WidgetEditContext } from "@/lib/config/widgets";
import { fetchWidgetForEditing, saveWidget } from "./admin/settingsApi";
import { useAutosave, SaveStatus } from "./admin/useAutosave";
import { useFeedHealth } from "./admin/FeedHealth";
import { INSTANCE_GROUPS } from "./admin/settings/widgets";
import { Hint } from "./admin/ui";

// Widget types whose settings are site-wide rather than per widget, and where
// they live.
const SITE_WIDE: Partial<Record<WidgetInstance["type"], string>> = {
  search: "The search engine and bangs are site-wide settings",
  weather: "The weather location is a site-wide setting",
  headerCard: "What the header card shows follows the site-wide clock, weather and status settings",
  clock: "The clock follows each visitor's own time zone and format",
  status: "Status checks are set up per app, with the switches in Settings → Monitoring",
};
const WIDGETS_SETTINGS = "/admin?tab=settings&section=widgets";

export default function WidgetPanel({
  id,
  label,
  onClose,
  onSaved,
}: {
  id: string;
  label: string;
  onClose: () => void;
  // A save landed: refresh the page's data.
  onSaved: () => void;
}) {
  const [context, setContext] = useState<WidgetEditContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWidgetForEditing(id).then(
      (c) => !cancelled && setContext(c),
      (e: Error) => !cancelled && setError(e.message)
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Focus lands on the panel when it opens (and on each widget switched to).
  useEffect(() => {
    headingRef.current?.focus();
  }, [id]);

  // On large screens the panel takes the right edge; the editor bar centers
  // itself in what's left (--editor-panel, read by EditToolbar).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--editor-panel", "26rem");
    return () => {
      root.style.removeProperty("--editor-panel");
    };
  }, []);

  // Escape closes it, wherever focus is — unless a menu inside it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("[data-widget-panel] details[open]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-editor-keep
      data-widget-panel
      role="dialog"
      aria-labelledby="widget-panel-title"
      className="fixed inset-x-0 bottom-0 z-[48] flex max-h-[80vh] flex-col rounded-t-2xl border-t border-fg/10 bg-[var(--background)] shadow-2xl lg:inset-x-auto lg:top-0 lg:right-0 lg:max-h-none lg:w-[26rem] lg:rounded-none lg:border-t-0 lg:border-l"
    >
      <div className="flex items-center gap-3 border-b border-fg/10 px-4 py-3">
        <h2
          id="widget-panel-title"
          ref={headingRef}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-sm font-semibold outline-none"
        >
          {label}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-fg/10 bg-fg/5 px-3 py-1 text-sm text-ink-80 transition-colors hover:bg-fg/10"
        >
          Done
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : !context ? (
          <p className="text-sm text-ink-55">Loading…</p>
        ) : (
          <WidgetEditor key={context.widget.id} context={context} label={label} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}

// Mounted once the widget has loaded, so the autosave's starting point is the
// stored widget and opening the panel saves nothing.
function WidgetEditor({
  context,
  label,
  onSaved,
}: {
  context: WidgetEditContext;
  label: string;
  onSaved: () => void;
}) {
  const [widget, setWidget] = useState<WidgetInstance>(context.widget);
  const { status, error } = useAutosave(widget, async (next, opts) => {
    await saveWidget(next, { keepalive: opts?.keepalive });
    onSaved();
  });
  const feedHealth = useFeedHealth(widget.type === "feed");
  const group = INSTANCE_GROUPS.find((g) => g.type === widget.type);

  if (!group) {
    const siteWide = SITE_WIDE[widget.type];
    return (
      <div className="flex flex-col gap-2">
        <Hint>
          {siteWide ? `${siteWide}.` : "This widget has nothing to set up — it shows what it shows."} Its size,
          place and heading are set right here on the page.
        </Hint>
        {siteWide && (
          <Link href={WIDGETS_SETTINGS} className="text-sm text-ink-70 underline hover:text-ink-90">
            Open Settings → Widgets
          </Link>
        )}
      </div>
    );
  }
  const { Editor, intro } = group;
  return (
    <div className="flex flex-col gap-4">
      <Hint>{intro}</Hint>
      <Editor
        w={widget as never}
        label={label}
        onChange={(patch) => setWidget((w) => ({ ...w, ...(patch as object) }) as WidgetInstance)}
        feedHealth={feedHealth}
        groups={context.groups}
        tags={context.tags}
        integrations={context.integrations}
      />
      <div className="text-xs">
        <SaveStatus status={status} error={error} />
      </div>
    </div>
  );
}
