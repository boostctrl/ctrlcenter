"use client";

import { RenameButton, RenameField } from "../InlineRename";
import type { ThemePack } from "@/lib/theme";
import { buttonClasses } from "@/lib/buttons";
import { DESIGN_NAMES } from "./constants";
import { OptionCard } from "./OptionCard";
import type { ThemeDraft } from "./useThemeDraft";

export default function ThemesTab({
  d,
  packs,
  promote,
}: {
  d: ThemeDraft;
  packs: ThemePack[];
  promote?: { siteMode: "system" | "light" | "dark" };
}) {
  const {
    customThemes,
    applyPack,
    applyNamedTheme,
    deleteNamedTheme,
    confirm,
    editMode,
    renamingId,
    setRenamingId,
    importStatus,
    promoteStatus,
    promoting,
    fileInputRef,
    commitRename,
    hasDuplicateNames,
    promoteTheme,
    exportThemes,
    handleImportFile,
    lookSwatch,
  } = d;
  return (
    <div
      role="tabpanel"
      id="tb-panel-themes"
      aria-labelledby="tb-tab-themes"
      className="space-y-4"
    >
      <p className="text-xs text-fg/40">
        Curated looks — one tap sets the design, scene &amp; colors of your{" "}
        {editMode} theme.{" "}
        Tweak it in the other tabs, then name &amp; save your own below.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {packs.map((p, i) => (
          <OptionCard
            key={`builtin:${i}`}
            onClick={() => applyPack(p, editMode)}
            name={p.name}
            title={`${p.name} · ${DESIGN_NAMES[p.design]}`}
            badge={i === 0 ? "Default" : undefined}
          >
            <span
              className="block h-10 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
              style={{ background: lookSwatch(p) }}
              aria-hidden
            />
          </OptionCard>
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold tracking-[0.15em] text-fg/45 uppercase">
            Your themes
          </span>
          {/* Import always (so an empty list can still receive a file);
              export only once there's something to export. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={buttonClasses("ghost")}
            >
              Import
            </button>
            {customThemes.length > 0 && (
              <button
                type="button"
                onClick={exportThemes}
                className={buttonClasses("ghost")}
              >
                Export
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFile}
              aria-label="Import themes file"
              className="hidden"
            />
          </div>
        </div>
        {customThemes.length === 0 && (
          <p className="text-xs text-fg/40">
            Import a themes file exported from another browser.
          </p>
        )}
        {importStatus && (
          <p role="status" className="text-xs text-fg/50">
            {importStatus}
          </p>
        )}
        {promoteStatus && (
          <p role="status" className="text-xs text-fg/50">
            {promoteStatus}
          </p>
        )}
        {/* Pre-1.9.3, Save always appended, so a name could land on two
            cards. Rename updates in place by id, but Save-under-a-name looks
            up by name and would recapture into the first match — nudge the
            user to give duplicates distinct names so Save is unambiguous
            (#144). */}
        {hasDuplicateNames && (
          <p className="text-[11px] text-fg/45">
            Some saved themes share a name — rename them so saving updates the
            one you mean.
          </p>
        )}
        {customThemes.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {customThemes.map((t) => {
              const swatch = (
                <span
                  className="block h-10 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                  style={{ background: lookSwatch(t) }}
                  aria-hidden
                />
              );
              return renamingId === t.id ? (
                <OptionCard
                  key={t.id}
                  name={t.name}
                  editingField={
                    <RenameField
                      initialValue={t.name}
                      maxLength={40}
                      label={`Rename ${t.name}`}
                      onCommit={(v) => commitRename(t.id, v)}
                      onCancel={() => setRenamingId(null)}
                      className="accent-focus min-w-0 rounded-md border border-fg/10 bg-fg/5 px-2 py-1 text-xs text-fg outline-none"
                    />
                  }
                >
                  {swatch}
                </OptionCard>
              ) : (
                <div key={t.id} className="group/theme relative">
                  <OptionCard
                    onClick={() => applyNamedTheme(t.id)}
                    name={t.name}
                    title={`${t.name} · ${DESIGN_NAMES[t.design]}`}
                  >
                    {swatch}
                  </OptionCard>
                  {/* Rename + delete both stay visible (hover-revealed meant
                      touch users couldn't reach them — tapping the card
                      applies the theme). Delete is confirmed: a saved theme
                      is two full modes of work with no undo (#121). */}
                  {promote && (
                    <button
                      type="button"
                      onClick={() => promoteTheme(t)}
                      disabled={promoting}
                      aria-label={`Set ${t.name} as the site theme`}
                      title="Set as site theme"
                      className="absolute top-1 right-13 rounded-md bg-background/70 px-1 py-1 text-fg/50 transition-colors hover:text-fg/90 disabled:opacity-40"
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                    </button>
                  )}
                  <RenameButton
                    label={`Rename ${t.name}`}
                    onClick={() => setRenamingId(t.id)}
                    className="absolute top-1 right-7 rounded-md bg-background/70 px-1 py-1 text-fg/50 transition-colors hover:text-fg/90"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `Delete “${t.name}”?`,
                          message:
                            "This saved theme is stored only in this browser and can't be recovered.",
                          confirmLabel: "Delete",
                          danger: true,
                        })
                      )
                        deleteNamedTheme(t.id);
                    }}
                    aria-label={`Delete ${t.name}`}
                    className="absolute top-1 right-1 rounded-md bg-background/70 px-1 text-xs text-fg/50 transition-colors hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
