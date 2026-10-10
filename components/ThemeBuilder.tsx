"use client";

import { useState } from "react";
import { ChipGroup } from "./ChipGroup";
import { useEdgeFade } from "./useEdgeFade";
import type { ThemePack } from "@/lib/theme";
import { buttonClasses } from "@/lib/buttons";
import { TABS, type TabId } from "./theme-builder/constants";
import { useThemeDraft } from "./theme-builder/useThemeDraft";
import ThemesTab from "./theme-builder/ThemesTab";
import ColorsTab from "./theme-builder/ColorsTab";
import DesignTab from "./theme-builder/DesignTab";
import TuneTab from "./theme-builder/TuneTab";
import SceneTab from "./theme-builder/SceneTab";
import FontTab from "./theme-builder/FontTab";
import { PreviewCard } from "./theme-builder/PreviewCard";

// The visitor theme builder: a header (mode switch), a tab strip and a footer
// (save/reset) around the open tab. The draft and every action live in
// useThemeDraft; each tab is its own component under ./theme-builder, editing
// through that draft.

// `promote` is only passed for an admin session: it enables "set as site
// theme" on each saved theme and carries the site default's current mode,
// which promotion must preserve (the settings API replaces the whole theme
// object). Promotion is a snapshot — later edits to the saved theme don't
// follow it.
export default function ThemeBuilder({
  packs,
  promote,
}: {
  packs: ThemePack[];
  promote?: { siteMode: "system" | "light" | "dark" };
}) {
  const draft = useThemeDraft(promote);
  const {
    setPreviewMode,
    resetTheme,
    confirm,
    editMode,
    name,
    setName,
    saveFailed,
    saveTheme,
    appliedName,
    modified,
    revertToApplied,
  } = draft;

  const [tab, setTab] = useState<TabId>("themes");

  // The tablist scrolls horizontally when the tabs overflow a narrow phone; the
  // shared edge fade signals which side is clipped (#143).
  const {
    ref: tablistRef,
    onScroll: measureTabClip,
    style: tabMaskStyle,
  } = useEdgeFade<HTMLDivElement>();

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="font-semibold">Theme builder</h2>
          <p className="text-xs text-ink-50">
            Light and dark are two independent themes — design each with its own
            style, scene, font &amp; colors. Everything applies live.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-50">Editing</span>
            <ChipGroup
              label="Editing mode"
              capitalize
              options={(["dark", "light"] as const).map((m) => ({
                value: m,
                label: (
                  <>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      {m === "dark" ? (
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                      ) : (
                        <>
                          <circle cx="12" cy="12" r="5" />
                          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                        </>
                      )}
                    </svg>
                    {m}
                  </>
                ),
              }))}
              value={editMode}
              onChange={setPreviewMode}
            />
          </div>
          <p className="text-[10px] text-ink-40">
            Previews live — your saved Appearance mode is untouched.
          </p>
        </div>
      </div>

      {/* What the look is based on, once a theme tile has been applied this
          visit, and a way back once it's been tweaked (#328). */}
      {appliedName && (
        <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-50">
          <span>
            Based on <span className="text-ink-80">{appliedName}</span>
            {modified ? " · modified" : ""}
          </span>
          {modified && (
            <button
              type="button"
              onClick={revertToApplied}
              className="rounded-md px-1.5 py-0.5 text-ink-70 underline underline-offset-2 transition-colors hover:text-fg"
            >
              Revert to {appliedName}
            </button>
          )}
        </p>
      )}

      {/* The preview sits beside the tabs on a wide screen and above them on
          a phone, where the live page is off-screen while editing. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start lg:gap-6">
      <div className="mb-4 lg:order-last lg:sticky lg:top-4 lg:mb-0">
        <PreviewCard mode={editMode} />
      </div>
      <div className="min-w-0 space-y-4">
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Theme builder sections"
        className="flex gap-1 overflow-x-auto border-b border-fg/10"
        onScroll={measureTabClip}
        style={tabMaskStyle}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tb-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`tb-panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`relative shrink-0 px-3 py-2 text-xs font-medium transition-colors ${
                active ? "text-fg" : "text-ink-50 hover:text-ink-80"
              }`}
            >
              {t.name}
              {active && (
                <span
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, var(--accent-from), var(--accent-to))",
                  }}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {tab === "themes" && <ThemesTab d={draft} packs={packs} promote={promote} />}
      {tab === "colors" && <ColorsTab d={draft} />}
      {tab === "design" && <DesignTab d={draft} />}
      {tab === "tune" && <TuneTab d={draft} />}
      {tab === "scene" && <SceneTab d={draft} canUpload={!!promote} />}
      {tab === "font" && <FontTab d={draft} />}
      </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-fg/10 pt-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void saveTheme();
          }}
          placeholder="Name this look to save it — both modes included"
          className="accent-focus min-w-0 flex-1 basis-56 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors"
        />
        <button
          type="button"
          onClick={saveTheme}
          disabled={!name.trim()}
          className={`${buttonClasses("primary")} shrink-0`}
        >
          Save theme
        </button>
        <button
          type="button"
          onClick={async () => {
            // An unsaved look is unrecoverable — confirm before discarding (#121).
            if (
              await confirm({
                title: "Reset the theme?",
                message:
                  "Returns colors, design, scene, and font to the site default. An unsaved look can't be recovered.",
                confirmLabel: "Reset",
                danger: true,
              })
            )
              resetTheme();
          }}
          title="Return the theme to the app default"
          className={`${buttonClasses("ghost")} shrink-0`}
        >
          Reset theme
        </button>
        {saveFailed && (
          <p role="status" className="w-full text-xs text-status-down">
            Couldn&apos;t save this theme — your browser is blocking local
            storage (private mode or full storage).
          </p>
        )}
      </div>
    </div>
  );
}
