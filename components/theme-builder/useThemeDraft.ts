"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useVisitorPrefs } from "../PrefsProvider";
import { useConfirm } from "../admin/Confirm";
import type { ModeColors } from "@/lib/theme";
import { parseThemesExport, siteThemeFromCustomTheme } from "@/lib/prefs";
import type { CustomTheme, ThemeColors } from "@/lib/prefs";
import { saveSettingsPatch } from "../admin/settingsApi";
import { downloadJson } from "@/lib/download";
import { deepenForLight } from "../scenes/color";
import { DEFAULT_DRAFT, MODE_DEFAULTS } from "./constants";

// The theme builder's state: the visitor-prefs actions it edits through, the
// color draft behind the pickers, the save/rename/import/promote flows and
// their status lines. One hook so every tab shares a single draft; each tab
// is its own component under ./theme-builder taking the result as `d`.
//
// `promote` is only passed for an admin session (see ThemeBuilder).
export function useThemeDraft(promote?: { siteMode: "system" | "light" | "dark" }) {
  const {
    designFor,
    setDesign,
    sceneFor,
    setScene,
    fontFor,
    setFont,
    applyPack,
    customThemes,
    activeLook,
    activeAccent,
    applyThemeColors,
    setBaseColors,
    setAccentOverride,
    saveNamedTheme,
    applyNamedTheme,
    renameNamedTheme,
    deleteNamedTheme,
    importNamedThemes,
    resetTheme,
    resolvedMode,
    setPreviewMode,
  } = useVisitorPrefs();
  const confirm = useConfirm();

  // Always edit the mode that's actually on screen, so what you tweak is what you
  // see. The Editing toggle in the header switches modes by previewing them live
  // (see setPreviewMode) rather than keeping a separate, hidden edit target.
  const editMode = resolvedMode;

  // Scene swatches paint the accent over the previewed surface, so on light they
  // must deepen it the same way the real scenes do (prefs/themeApply / scenes/color)
  // — otherwise the swatch washes out while the live scene behind it pops.
  const sceneFrom =
    editMode === "light"
      ? `rgb(${deepenForLight(activeAccent.from)})`
      : activeAccent.from;
  const sceneTo =
    editMode === "light"
      ? `rgb(${deepenForLight(activeAccent.to)})`
      : activeAccent.to;

  // The preview is display-only and never persisted, so dropping it when the
  // builder unmounts returns the visitor to their saved Appearance mode the
  // moment they leave the page. A latest-value ref keeps this an unmount-only
  // cleanup that still calls the current setPreviewMode (whose identity changes
  // as theme state updates), so it applies the up-to-date look, not a stale one.
  const dropPreview = useRef(setPreviewMode);
  useEffect(() => {
    dropPreview.current = setPreviewMode;
  });
  useEffect(() => () => dropPreview.current(null), []);

  const [draft, setDraft] = useState<ThemeColors>(DEFAULT_DRAFT);
  const [name, setName] = useState("");
  // Saving a theme can fail when the browser blocks local storage (private
  // mode, quota); say so instead of a button that silently does nothing.
  const [saveFailed, setSaveFailed] = useState(false);
  // Which saved theme's card is showing its inline rename field (null = none).
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // The outcome of the last import, shown in the Your-themes section.
  const [importStatus, setImportStatus] = useState<string | null>(null);
  // Outcome of the last "set as site theme" (admin only), same treatment.
  const [promoteStatus, setPromoteStatus] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Whether the accent editor shows one color well or a from→to pair. Solid is
  // just a gradient with two equal stops, so this is purely a UI simplification
  // for the common "I want one color" case.
  const [accentStyle, setAccentStyle] = useState<"gradient" | "solid">(() =>
    activeAccent.from.toLowerCase() === activeAccent.to.toLowerCase()
      ? "solid"
      : "gradient"
  );

  // Keep the pickers in sync with the edit mode's colorset. Background/text come
  // from the active look's chosen-mode variant (or that mode's defaults when
  // there's no custom look yet); activeAccent resolves for the edit mode too.
  useEffect(() => {
    const cs = activeLook ? activeLook[editMode] : null;
    const dflt = MODE_DEFAULTS[editMode];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({
      background: cs?.background ?? dflt.background,
      foreground: cs?.foreground ?? dflt.foreground,
      accentFrom: activeAccent.from,
      accentTo: activeAccent.to,
    });
  }, [activeLook, editMode, activeAccent]);

  // A palette or saved theme can bring in a two-color accent the Solid editor
  // can't represent — flip back to the gradient editor when that happens.
  useEffect(() => {
    if (draft.accentFrom.toLowerCase() !== draft.accentTo.toLowerCase()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAccentStyle("gradient");
    }
  }, [draft.accentFrom, draft.accentTo]);

  function updateBase(key: "background" | "foreground", value: string) {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setBaseColors(next.background, next.foreground, editMode === "dark");
  }

  function updateAccent(key: "accentFrom" | "accentTo", value: string) {
    const next =
      accentStyle === "solid"
        ? { ...draft, accentFrom: value, accentTo: value }
        : { ...draft, [key]: value };
    setDraft(next);
    setAccentOverride({ from: next.accentFrom, to: next.accentTo }, editMode);
  }

  function chooseAccentStyle(style: "gradient" | "solid") {
    setAccentStyle(style);
    // Collapsing to solid keeps the start color; going back to gradient changes
    // nothing until an end color is picked.
    if (style === "solid" && draft.accentFrom !== draft.accentTo) {
      const next = { ...draft, accentTo: draft.accentFrom };
      setDraft(next);
      setAccentOverride({ from: next.accentFrom, to: next.accentTo }, editMode);
    }
  }

  async function saveTheme() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Saving under a name that's already taken updates that theme in place
    // (after confirming) rather than piling up a second copy under one name.
    const existing = customThemes.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      const ok = await confirm({
        title: `Update “${existing.name}”?`,
        message:
          "A saved theme with this name already exists — its saved look will be replaced with the one on screen now.",
        confirmLabel: "Update",
      });
      // Declined: keep the typed name so they can rename before saving.
      if (!ok) return;
    }
    // Captures the full current look — both modes' design, scene, font and
    // colors — so it restores as two complete, independent themes.
    const saved = saveNamedTheme(name, existing?.id);
    setSaveFailed(!saved);
    if (saved) setName("");
  }

  // Commit an inline rename. An empty field leaves the saved name untouched; a
  // failed write surfaces the same storage-blocked notice the save path uses.
  // RenameField suppresses the commit on an Escape cancel, so this only runs on
  // a real commit.
  function commitRename(id: string, value: string) {
    const next = value.trim();
    if (next) setSaveFailed(!renameNamedTheme(id, next));
    setRenamingId(null);
  }

  // Pre-1.9.3 saves could pile two cards under one name; flag it so Save's
  // update-in-place stays unambiguous (#144).
  const nameCounts = new Map<string, number>();
  for (const t of customThemes) {
    const key = t.name.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const hasDuplicateNames = [...nameCounts.values()].some((n) => n > 1);

  // Snapshot a saved theme into the site default every visitor sees (#142).
  // The field mapping lives in lib/prefs.ts (siteThemeFromCustomTheme), where
  // a test pins it against the settings schema. The API is admin-gated; the
  // button only renders when the server said this session is an admin.
  async function promoteTheme(t: CustomTheme) {
    if (!promote || promoting) return;
    const ok = await confirm({
      title: `Make “${t.name}” the site theme?`,
      message:
        "This look becomes the default every visitor sees, in both light " +
        "and dark. It's a copy — later edits to this saved theme won't " +
        "follow — and visitors' own customizations still apply on top.",
      confirmLabel: "Set site theme",
    });
    if (!ok) return;
    setPromoting(true);
    try {
      await saveSettingsPatch(
        { theme: siteThemeFromCustomTheme(t, promote.siteMode) },
        { fallback: "Couldn't set the site theme." }
      );
      setPromoteStatus(`“${t.name}” is now the site theme.`);
    } catch (e) {
      setPromoteStatus(
        e instanceof Error ? e.message : "Couldn't set the site theme."
      );
    } finally {
      setPromoting(false);
    }
  }

  // Download the saved themes as a JSON file the visitor can carry to another
  // browser (or back it up).
  function exportThemes() {
    downloadJson("ctrlcenter-themes.json", customThemes);
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset first so picking the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;
    let themes: CustomTheme[] = [];
    try {
      themes = parseThemesExport(JSON.parse(await file.text()));
    } catch {
      // Not JSON at all — treated the same as a file with no themes in it.
      themes = [];
    }
    if (themes.length === 0) {
      setImportStatus("That file doesn't contain any saved themes.");
      return;
    }
    const added = importNamedThemes(themes);
    if (added === null) {
      setImportStatus(
        "Couldn't import — your browser is blocking local storage (private mode or full storage)."
      );
    } else if (added === 0) {
      setImportStatus("Those themes are already saved.");
    } else {
      setImportStatus(`Imported ${added} theme${added === 1 ? "" : "s"}.`);
    }
  }

  // A full-look swatch (surface bg + accent glow) for the current mode — used
  // for the theme packs and saved themes, which restyle the mode being edited.
  const lookSwatch = (look: ModeColors) => {
    const cs = editMode === "light" ? look.light : look.dark;
    return `radial-gradient(120% 100% at 50% -10%, ${cs.accentFrom}, transparent 60%), ${cs.background}`;
  };

  return {
    designFor,
    setDesign,
    sceneFor,
    setScene,
    fontFor,
    setFont,
    applyPack,
    customThemes,
    activeAccent,
    applyThemeColors,
    applyNamedTheme,
    deleteNamedTheme,
    resetTheme,
    setPreviewMode,
    confirm,
    editMode,
    sceneFrom,
    sceneTo,
    draft,
    name,
    setName,
    saveFailed,
    renamingId,
    setRenamingId,
    importStatus,
    promoteStatus,
    promoting,
    fileInputRef,
    accentStyle,
    updateBase,
    updateAccent,
    chooseAccentStyle,
    saveTheme,
    commitRename,
    hasDuplicateNames,
    promoteTheme,
    exportThemes,
    handleImportFile,
    lookSwatch,
  };
}

export type ThemeDraft = ReturnType<typeof useThemeDraft>;
