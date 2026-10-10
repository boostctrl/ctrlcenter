"use client";

import { RenameButton, RenameField } from "../InlineRename";
import { DEFAULT_THEME_NAME, packDesign, packScene, type ThemePack } from "@/lib/theme";
import { buttonClasses } from "@/lib/buttons";
import { DESIGN_NAMES } from "./constants";
import { OptionCard } from "./OptionCard";
import { ThemeTile } from "./ThemeTile";
import type { ThemeDraft } from "./useThemeDraft";

export default function ThemesTab({
  d,
  packs,
  promote,
  packsOnly = false,
}: {
  d: ThemeDraft;
  packs: ThemePack[];
  promote?: { siteMode: "system" | "light" | "dark" };
  // Under the "themes only" policy (#335): just the site's themes.
  packsOnly?: boolean;
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
    galleryStatus,
    addingToGallery,
    codeStatus,
    pasteOpen,
    setPasteOpen,
    pasteText,
    setPasteText,
    copyCode,
    pasteCode,
    fileInputRef,
    commitRename,
    hasDuplicateNames,
    promoteTheme,
    addToGallery,
    exportThemes,
    handleImportFile,
    packActive,
    savedActive,
  } = d;
  return (
    <div
      role="tabpanel"
      id="tb-panel-themes"
      aria-labelledby="tb-tab-themes"
      className="space-y-4"
    >
      <p className="text-xs text-ink-40">
        Curated looks — one tap sets the design, scene &amp; colors of your{" "}
        {editMode} theme.{" "}
        {!packsOnly && "Tweak it in the other tabs, then name & save your own below."}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {packs.map((p, i) => (
          <OptionCard
            key={`builtin:${i}`}
            onClick={() => applyPack(p, editMode)}
            selected={packActive(p, editMode)}
            name={p.name}
            title={`${p.name} · ${DESIGN_NAMES[packDesign(p, editMode === "dark")]}`}
            badge={(p.builtin ?? p.name) === DEFAULT_THEME_NAME ? "Default" : undefined}
          >
            <ThemeTile
              design={packDesign(p, editMode === "dark")}
              scene={packScene(p, editMode === "dark")}
              colors={p[editMode]}
              mode={editMode}
            />
          </OptionCard>
        ))}
      </div>
      {!packsOnly && (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-semibold tracking-[0.15em] text-ink-45 uppercase">
            Your themes
          </span>
          {/* Import always (so an empty list can still receive a file);
              export only once there's something to export. A code carries one
              look as text (#329): copy the current one, or paste one in. */}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={copyCode} className={buttonClasses("ghost")}>
              Copy as code
            </button>
            <button
              type="button"
              onClick={() => setPasteOpen(!pasteOpen)}
              aria-expanded={pasteOpen}
              className={buttonClasses("ghost")}
            >
              Paste a code
            </button>
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
        {pasteOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pasteCode();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste a theme code or link"
              aria-label="Theme code"
              spellCheck={false}
              className="accent-focus min-w-0 flex-1 basis-56 rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 font-mono text-xs text-fg outline-none transition-colors"
            />
            <button type="submit" disabled={!pasteText.trim()} className={buttonClasses("primary")}>
              Apply
            </button>
          </form>
        )}
        {codeStatus && (
          <p role="status" className="text-xs text-ink-50">
            {codeStatus}
          </p>
        )}
        {customThemes.length === 0 && (
          <p className="text-xs text-ink-40">
            Import a themes file exported from another browser, or paste a code.
          </p>
        )}
        {importStatus && (
          <p role="status" className="text-xs text-ink-50">
            {importStatus}
          </p>
        )}
        {promoteStatus && (
          <p role="status" className="text-xs text-ink-50">
            {promoteStatus}
          </p>
        )}
        {galleryStatus && (
          <p role="status" className="text-xs text-ink-50">
            {galleryStatus}
          </p>
        )}
        {/* Two saved themes can share a name (saves before 1.9.3 appended,
            and an import skips only exact copies). Rename updates in place by
            id, but Save-under-a-name looks up by name and would recapture
            into the first match — nudge the user to give duplicates distinct
            names so Save is unambiguous (#144). */}
        {hasDuplicateNames && (
          <p className="text-[11px] text-ink-45">
            Some saved themes share a name — rename them so saving updates the
            one you mean.
          </p>
        )}
        {customThemes.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {customThemes.map((t) => {
              const swatch = (
                <ThemeTile
                  design={editMode === "dark" ? t.design : t.designLight}
                  scene={editMode === "dark" ? t.scene : t.sceneLight}
                  colors={t[editMode]}
                  mode={editMode}
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
                    selected={savedActive(t)}
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
                      onClick={() => addToGallery(t)}
                      disabled={addingToGallery}
                      aria-label={`Add ${t.name} to the site's themes`}
                      title="Add to site themes"
                      className="absolute top-1 right-19 rounded-md bg-background/70 px-1 py-1 text-ink-50 transition-colors hover:text-ink-90 disabled:opacity-40"
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
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <line x1="17.5" y1="14" x2="17.5" y2="21" />
                        <line x1="14" y1="17.5" x2="21" y2="17.5" />
                      </svg>
                    </button>
                  )}
                  {promote && (
                    <button
                      type="button"
                      onClick={() => promoteTheme(t)}
                      disabled={promoting}
                      aria-label={`Set ${t.name} as the site theme`}
                      title="Set as site theme"
                      className="absolute top-1 right-13 rounded-md bg-background/70 px-1 py-1 text-ink-50 transition-colors hover:text-ink-90 disabled:opacity-40"
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
                    className="absolute top-1 right-7 rounded-md bg-background/70 px-1 py-1 text-ink-50 transition-colors hover:text-ink-90"
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
                    className="absolute top-1 right-1 rounded-md bg-background/70 px-1 text-xs text-ink-50 transition-colors hover:text-status-down"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
