"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Settings } from "@/lib/schema";
import type { ThemePack } from "@/lib/theme";
import { replaceUrlParams } from "./urlState";
import { SaveStatus } from "./useAutosave";
import {
  LEGACY_SECTION_ALIASES,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./settings/constants";
import { NO_ZONES, getBrowserZones, subscribeZonesNever } from "./settings/zones";
import { useSettingsDraft } from "./settings/useSettingsDraft";
import GeneralSection from "./settings/GeneralSection";
import LayoutSection from "./settings/LayoutSection";
import WidgetsSection from "./settings/WidgetsSection";
import MonitoringSection from "./settings/MonitoringSection";
import IntegrationsSection from "./settings/IntegrationsSection";
import AnnouncementsSection from "./settings/AnnouncementsSection";
import SecuritySection from "./settings/SecuritySection";

// The admin settings page: a section nav rail beside the open section's cards.
// The draft settings object and its autosave live in useSettingsDraft; each
// section is its own component under ./settings, editing through that draft.

export default function SettingsManager({
  initialSettings,
  themePacks,
  initialSection,
  initialTwoFactorEnabled,
}: {
  initialSettings: Settings;
  themePacks: ThemePack[];
  // The ?section deep-link param, read server-side by /admin's page (see
  // AdminDashboard's matching prop for why useSearchParams is avoided).
  initialSection?: string;
  initialTwoFactorEnabled: boolean;
}) {
  const draft = useSettingsDraft(initialSettings, themePacks);
  const { status, error } = draft;
  // The URL seeds the active section (?tab=settings&section=widgets is a
  // shareable deep link that survives refresh); rail clicks mirror it back
  // with a history replace. AdminDashboard owns the `tab` param the same way.
  const [section, setSection] = useState<SettingsSectionId>(() => {
    if (SETTINGS_SECTIONS.some((s) => s.id === initialSection))
      return initialSection as SettingsSectionId;
    return (initialSection && LEGACY_SECTION_ALIASES[initialSection]) || "general";
  });
  const activeSection =
    SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];

  function selectSection(next: SettingsSectionId) {
    setSection(next);
    replaceUrlParams((params) => params.set("section", next));
  }

  // Honor a #settings-card-… hash once on mount (the anchors each card
  // carries), so a link can point at one card inside a long section.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#settings-card-")) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, []);
  // Empty on the server and during hydration, the browser's own list after
  // mount — see the NO_ZONES/getBrowserZones comment in ./settings/zones.
  const zones = useSyncExternalStore(
    subscribeZonesNever,
    getBrowserZones,
    () => NO_ZONES
  );

  return (
    // Settings-page shell: a nav rail (horizontal pills on small screens, a
    // sticky vertical rail on lg+) beside a content area that fills the rest of
    // the width, so any setting is one click away instead of somewhere down a
    // masonry flow.
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-x-8">
      {/* Shared zone suggestions for every `list="settings-tz"` input — the
          default time zone (General) and the world clocks (Widgets) — so it
          can't be stranded in one section's DOM. */}
      <datalist id="settings-tz">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-1 lg:sticky lg:top-6 lg:flex-col lg:flex-nowrap lg:self-start"
      >
        {SETTINGS_SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => selectSection(s.id)}
            className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap transition-colors ${
              section === s.id
                ? "bg-fg/10 font-medium text-fg"
                : "text-ink-50 hover:bg-fg/5 hover:text-ink-80"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        {/* Section header: which group is open (the rail is far away on
            phones), its one-line scope, and the autosave state on the right. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div>
            <h2 className="text-lg font-semibold">{activeSection.label}</h2>
            <p className="text-xs text-ink-40">{activeSection.blurb}</p>
          </div>
          <SaveStatus status={status} error={error} />
        </div>

        {/* The group's cards use the whole content cell (#161) on a GRID: one
            column normally, two side-by-side once the cell gives each ~500px+
            (container query, so the split follows the actual cell, not the
            viewport). A grid, not CSS columns (#134/#180): DOM order is
            reading order — left-right, top-bottom — and a card growing
            (enabling a feature) never re-positions its neighbors. Rows keep
            the default stretch alignment so a row's two cards share a height
            and the columns stay level (#64's imbalance, finally resolved):
            a short card gains interior breathing room instead of leaving a
            hole in the page beside a taller neighbor. */}
        <div className="@container">
        <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-2">
        {section === "general" && <GeneralSection d={draft} themePacks={themePacks} />}
        {section === "layout" && <LayoutSection d={draft} />}
        {section === "widgets" && <WidgetsSection d={draft} />}
        {section === "monitoring" && <MonitoringSection d={draft} />}
        {section === "integrations" && <IntegrationsSection d={draft} />}
        {section === "announcements" && <AnnouncementsSection d={draft} />}
        {section === "security" && (
          <SecuritySection initialTwoFactorEnabled={initialTwoFactorEnabled} />
        )}
        </div>
        </div>
      </div>
    </div>
  );
}
