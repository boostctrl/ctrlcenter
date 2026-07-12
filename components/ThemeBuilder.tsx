"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent, ReactNode } from "react";
import { useVisitorPrefs } from "./PrefsProvider";
import { ChipGroup } from "./ChipGroup";
import { RenameButton, RenameField } from "./InlineRename";
import { useEdgeFade } from "./useEdgeFade";
import { useConfirm } from "./admin/Confirm";
import { BASE_THEMES, DESIGNS, SCENES } from "@/lib/theme";
import type { DesignId, ModeColors, SceneId, ThemePack } from "@/lib/theme";
import { buttonClasses } from "@/lib/buttons";
import { FONTS, fontVar } from "@/lib/fonts";
import { parseThemesExport, siteThemeFromCustomTheme } from "@/lib/prefs";
import type { CustomTheme, ThemeColors } from "@/lib/prefs";
import { apiErrorMessage } from "./admin/apiError";
import { downloadJson } from "@/lib/download";
import { deepenForLight } from "./scenes/color";

const DESIGN_NAMES = Object.fromEntries(
  DESIGNS.map((d) => [d.id, d.name])
) as Record<DesignId, string>;

const DEFAULT_DRAFT: ThemeColors = {
  background: "#06070d",
  foreground: "#f4f4f6",
  accentFrom: "#a78bfa",
  accentTo: "#22d3ee",
};

// Surface defaults per mode (mirror the :root / .theme-light CSS), used to seed
// the pickers when editing a mode that has no custom colors yet.
const MODE_DEFAULTS: Record<"dark" | "light", { background: string; foreground: string }> = {
  dark: { background: "#06070d", foreground: "#f4f4f6" },
  light: { background: "#eceef3", foreground: "#181b24" },
};

const BASE_FIELDS: { key: "background" | "foreground"; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text & surfaces" },
];

// The builder's sections, one per tab. Tabs keep the five option grids from
// stacking into one endless scroll — you see one grid at a time, while the
// header (mode switch) and footer (save/reset) stay put around them.
const TABS = [
  { id: "themes", name: "Themes" },
  { id: "colors", name: "Colors" },
  { id: "design", name: "Design" },
  { id: "scene", name: "Scene" },
  { id: "font", name: "Font" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// A small representative gradient for each scene's picker swatch, recolored live
// by the active accent. The base is the live surface (`var(--background)`), so
// every swatch tracks the current light/dark mode.
function scenePreview(id: SceneId, from: string, to: string): string {
  const mix = (c: string, pct: number) =>
    `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  const bg = "var(--background)";
  switch (id) {
    case "abyss":
      return `radial-gradient(120% 90% at 50% -10%, ${from}, transparent 60%), ${bg}`;
    case "nebula":
      return `radial-gradient(45% 55% at 22% 28%, ${from}, transparent 60%), radial-gradient(50% 60% at 75% 68%, ${to}, transparent 60%), radial-gradient(40% 50% at 55% 45%, ${from}, transparent 65%), radial-gradient(35% 45% at 40% 80%, ${to}, transparent 65%), ${bg}`;
    case "grid":
      return `linear-gradient(to top, ${mix(from, 50)}, transparent 55%), repeating-linear-gradient(90deg, ${mix(from, 55)} 0 1px, transparent 1px 9px), repeating-linear-gradient(0deg, ${mix(from, 55)} 0 1px, transparent 1px 9px), ${bg}`;
    case "starfield":
      return `linear-gradient(54deg, transparent 48%, ${mix(from, 45)} 49% 51%, transparent 52%), radial-gradient(1.5px 1.5px at 22% 32%, ${from}, transparent), radial-gradient(2px 2px at 50% 80%, ${from}, transparent), radial-gradient(1.5px 1.5px at 62% 58%, ${to}, transparent), radial-gradient(2px 2px at 82% 26%, ${from}, transparent), radial-gradient(1.5px 1.5px at 42% 78%, ${to}, transparent), ${bg}`;
    case "traces":
      return [
        `radial-gradient(circle, ${from} 55%, transparent 60%) 12% 40% / 7px 7px no-repeat`,
        `radial-gradient(circle, ${to} 55%, transparent 60%) 84% 78% / 7px 7px no-repeat`,
        `linear-gradient(${mix(from, 55)}, ${mix(from, 55)}) 12% 40% / 44% 2px no-repeat`,
        `linear-gradient(${mix(from, 55)}, ${mix(from, 55)}) 56% 40% / 2px 40% no-repeat`,
        `linear-gradient(${mix(to, 50)}, ${mix(to, 50)}) 40% 78% / 44% 2px no-repeat`,
        bg,
      ].join(", ");
    case "rays":
      return `repeating-conic-gradient(from 0deg at 50% -12%, ${mix(from, 65)} 0 3deg, transparent 3deg 12deg), ${bg}`;
    case "waves":
      return `linear-gradient(to top, ${mix(from, 52)}, transparent 45%), linear-gradient(to top, ${mix(to, 32)}, transparent 65%), ${bg}`;
    case "dots":
      return `radial-gradient(${mix(from, 70)} 1px, transparent 1.5px) 0 0 / 6px 6px, ${bg}`;
    case "horizon":
      return `linear-gradient(${mix(from, 90)}, ${mix(from, 90)}) 0 62% / 100% 1px no-repeat, radial-gradient(circle at 50% 68%, ${from}, ${mix(to, 55)} 32%, transparent 52%), linear-gradient(to top, ${mix(to, 25)} 38%, transparent 38%), ${bg}`;
    case "orbit":
      return `radial-gradient(circle at 72% 34%, ${from} 4%, transparent 5.5%, transparent 17%, ${mix(from, 70)} 18%, transparent 19.5%, transparent 37%, ${mix(to, 55)} 38%, transparent 39.5%, transparent 57%, ${mix(from, 45)} 58%, transparent 59.5%), ${bg}`;
    case "peaks":
      return `linear-gradient(155deg, transparent 52%, ${mix(to, 30)} 52.5%), linear-gradient(205deg, transparent 55%, ${mix(from, 45)} 55.5%), linear-gradient(160deg, transparent 68%, ${mix(from, 65)} 68.5%), ${bg}`;
    case "rain":
      return `repeating-linear-gradient(100deg, transparent 0 5px, ${mix(from, 55)} 5px 6px, transparent 6px 13px, ${mix(to, 40)} 13px 14px), ${bg}`;
    case "fireflies":
      return `radial-gradient(4px 4px at 24% 38%, ${from}, transparent), radial-gradient(3px 3px at 64% 26%, ${to}, transparent), radial-gradient(4.5px 4.5px at 82% 66%, ${from}, transparent), radial-gradient(3px 3px at 44% 74%, ${to}, transparent), radial-gradient(2.5px 2.5px at 12% 72%, ${from}, transparent), ${bg}`;
    case "blueprint":
      return `radial-gradient(circle at 70% 42%, transparent 26%, ${mix(to, 70)} 27%, transparent 29%), repeating-linear-gradient(90deg, ${mix(from, 35)} 0 1px, transparent 1px 7px), repeating-linear-gradient(0deg, ${mix(from, 35)} 0 1px, transparent 1px 7px), ${bg}`;
    case "prisms":
      return `conic-gradient(from 205deg at 30% 42%, ${mix(from, 60)} 0 55deg, transparent 55deg), conic-gradient(from 20deg at 68% 64%, ${mix(to, 50)} 0 48deg, transparent 48deg), conic-gradient(from 120deg at 84% 22%, ${mix(from, 40)} 0 60deg, transparent 60deg), ${bg}`;
    case "petals":
      return `radial-gradient(5px 3px at 22% 30%, ${from} 70%, transparent), radial-gradient(4px 2.5px at 46% 62%, ${mix(from, 75)} 70%, transparent), radial-gradient(5px 3px at 68% 26%, ${to} 70%, transparent), radial-gradient(4px 2.5px at 84% 70%, ${mix(from, 70)} 70%, transparent), radial-gradient(4.5px 3px at 32% 82%, ${mix(to, 70)} 70%, transparent), radial-gradient(4px 2.5px at 58% 44%, ${mix(from, 60)} 70%, transparent), ${bg}`;
    case "comets":
      return `radial-gradient(2.5px 2.5px at 30% 38%, ${from}, transparent), linear-gradient(150deg, transparent 30%, ${mix(from, 65)} 36%, transparent 39%) no-repeat 0 0 / 62% 76%, radial-gradient(2px 2px at 72% 64%, ${to}, transparent), linear-gradient(150deg, transparent 56%, ${mix(to, 50)} 62%, transparent 65%) no-repeat 40% 100% / 60% 100%, ${bg}`;
    case "aurora":
    default:
      return `radial-gradient(60% 70% at 30% 20%, ${from}, transparent 60%), radial-gradient(60% 70% at 75% 80%, ${to}, transparent 60%), ${bg}`;
  }
}

// The card box shared by every option tile and by its rename state, so a shell
// restyle (padding, radius, gap) can't leave one behind (#144).
const CARD_SHELL = "flex w-full flex-col gap-1.5 rounded-lg border p-2";

// The shared shape of every option tile: swatch on top (children), name +
// optional description below, an optional corner badge, and an accent check
// when it's the active choice. Options that are one-shot actions rather than
// state (packs, palettes) simply omit `selected`. Pass `editingField` to render
// the same shell as a non-interactive card with an inline rename input where the
// name would be — an input can't live inside the tile's <button> (#144).
function OptionCard({
  onClick,
  name,
  selected,
  desc,
  title,
  badge,
  nameStyle,
  children,
  editingField,
}: {
  onClick?: () => void;
  name: string;
  selected?: boolean;
  desc?: string;
  title?: string;
  badge?: string;
  nameStyle?: CSSProperties;
  children: ReactNode;
  editingField?: ReactNode;
}) {
  if (editingField) {
    return (
      <div className={`${CARD_SHELL} border-fg/10`}>
        {children}
        {editingField}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={title}
      className={`group relative ${CARD_SHELL} text-left transition-colors ${
        selected ? "border-[color:var(--accent-from)]" : "border-fg/10 hover:border-fg/30"
      }`}
    >
      {children}
      <span className="min-w-0">
        <span
          className={`block truncate text-xs ${
            selected ? "text-fg/90" : "text-fg/60 group-hover:text-fg/90"
          }`}
          style={nameStyle}
        >
          {name}
        </span>
        {desc && (
          <span className="block truncate text-[10px] text-fg/40">{desc}</span>
        )}
      </span>
      {badge && (
        <span className="absolute top-1 right-1 rounded bg-fg/15 px-1 text-[9px] font-medium tracking-wide text-fg/70 uppercase">
          {badge}
        </span>
      )}
      {selected && (
        <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--accent-from)] text-[color:var(--accent-fg)] shadow-sm">
          <svg
            width="9"
            height="9"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2.5 6.5 5 9l4.5-6" />
          </svg>
        </span>
      )}
    </button>
  );
}

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
  // must deepen it the same way the real scenes do (PrefsProvider / scenes/color)
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

  const [tab, setTab] = useState<TabId>("themes");
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

  // The tablist scrolls horizontally when the tabs overflow a narrow phone; the
  // shared edge fade signals which side is clipped (#143).
  const {
    ref: tablistRef,
    onScroll: measureTabClip,
    style: tabMaskStyle,
  } = useEdgeFade<HTMLDivElement>();

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
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: siteThemeFromCustomTheme(t, promote.siteMode),
        }),
      });
      if (res.ok) {
        setPromoteStatus(`“${t.name}” is now the site theme.`);
      } else {
        const data = await res.json().catch(() => null);
        setPromoteStatus(apiErrorMessage(data, "Couldn't set the site theme."));
      }
    } catch {
      setPromoteStatus("Couldn't set the site theme.");
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

  // Palettes recolor BOTH modes at once, so their swatch shows both halves —
  // dark surface left, light surface right, each with its ink — over an accent
  // strip that blends from the dark half's accent pair into the light half's.
  const PaletteSwatch = ({ look }: { look: ModeColors }) => (
    <span
      className="relative block h-10 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
      aria-hidden
    >
      {(
        [
          ["dark", "left-0"],
          ["light", "right-0"],
        ] as const
      ).map(([m, side]) => (
        <span
          key={m}
          className={`absolute inset-y-0 ${side} w-1/2`}
          style={{ background: look[m].background }}
        >
          <span
            className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[10px] leading-none font-semibold"
            style={{ color: look[m].foreground }}
          >
            A
          </span>
        </span>
      ))}
      <span
        className="absolute inset-x-0 bottom-0 h-2.5"
        style={{
          backgroundImage: `linear-gradient(to right, ${look.dark.accentFrom}, ${look.dark.accentTo} 48%, ${look.light.accentFrom} 52%, ${look.light.accentTo})`,
        }}
      />
    </span>
  );

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="font-semibold">Theme builder</h2>
          <p className="text-xs text-fg/50">
            Light and dark are two independent themes — design each with its own
            style, scene, font &amp; colors. Everything applies live.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg/50">Editing</span>
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
          <p className="text-[10px] text-fg/40">
            Previews live — your saved Appearance mode is untouched.
          </p>
        </div>
      </div>

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
                active ? "text-fg" : "text-fg/50 hover:text-fg/80"
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

      {tab === "themes" && (
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
      )}

      {tab === "colors" && (
        <div
          role="tabpanel"
          id="tb-panel-colors"
          aria-labelledby="tb-tab-colors"
          className="space-y-5"
        >
          <div className="space-y-2">
            <div>
              <span className="text-[10px] font-semibold tracking-[0.15em] text-fg/45 uppercase">
                Palettes
              </span>
              <p className="text-xs text-fg/40">
                Ready-made color sets — one tap recolors both modes (each swatch
                shows its dark and light halves).
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
              {BASE_THEMES.map((t) => (
                <OptionCard
                  key={t.name}
                  onClick={() => applyThemeColors(t)}
                  name={t.name}
                  title={t.name}
                >
                  <PaletteSwatch look={t} />
                </OptionCard>
              ))}
            </div>
          </div>

          <div className="space-y-3 border-t border-fg/10 pt-4">
            <div>
              <span className="text-[10px] font-semibold tracking-[0.15em] text-fg/45 uppercase">
                Custom
              </span>
              <p className="text-xs text-fg/40">
                Or pick each color yourself — changes apply instantly.
              </p>
            </div>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div className="space-y-2">
                <span className="block text-[11px] font-medium text-fg/55">
                  Surface — {editMode} theme only
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {BASE_FIELDS.map(({ key, label }) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-fg/10 bg-fg/5 p-2 transition-colors hover:border-fg/25"
                    >
                      <input
                        type="color"
                        value={draft[key]}
                        onChange={(e) => updateBase(key, e.target.value)}
                        aria-label={label}
                        className="color-well h-9 w-9 shrink-0 cursor-pointer rounded-full"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs text-fg/75">
                          {label}
                        </span>
                        <span className="block font-mono text-[10px] text-fg/40 uppercase">
                          {draft[key]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {/* Live sample of the mode being edited, so even the half you're
                    not looking at gets feedback as you pick. */}
                <div
                  className="flex h-11 items-center justify-between overflow-hidden rounded-lg px-3 ring-1 ring-fg/10"
                  style={{
                    background: `radial-gradient(120% 150% at 80% -30%, ${draft.accentFrom}, transparent 55%), ${draft.background}`,
                  }}
                >
                  <span
                    className="text-xs font-medium capitalize"
                    style={{ color: draft.foreground }}
                  >
                    {editMode} preview · Aa
                  </span>
                  <span
                    className="h-1.5 w-12 shrink-0 rounded-full"
                    style={{
                      backgroundImage: `linear-gradient(to right, ${draft.accentFrom}, ${draft.accentTo})`,
                    }}
                    aria-hidden
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-fg/55">
                    Accent — {editMode} theme only
                  </span>
                  <ChipGroup
                    label="Accent style"
                    size="2xs"
                    rounded="md"
                    capitalize
                    options={(["gradient", "solid"] as const).map((s) => ({
                      value: s,
                      label: s,
                    }))}
                    value={accentStyle}
                    onChange={chooseAccentStyle}
                  />
                </div>
                {/* The accent editor IS the gradient: a bar with a color well at
                    each end (or one centered well when solid). */}
                <div
                  className="relative h-11 rounded-full ring-1 ring-fg/10"
                  style={{
                    backgroundImage: `linear-gradient(to right, ${draft.accentFrom}, ${draft.accentTo})`,
                  }}
                >
                  <input
                    type="color"
                    value={draft.accentFrom}
                    onChange={(e) => updateAccent("accentFrom", e.target.value)}
                    aria-label={
                      accentStyle === "solid"
                        ? "Accent color"
                        : "Accent start color"
                    }
                    className={`color-well absolute top-1/2 h-7 w-7 -translate-y-1/2 cursor-pointer rounded-full shadow-md ${
                      accentStyle === "solid"
                        ? "left-1/2 -translate-x-1/2"
                        : "left-2"
                    }`}
                  />
                  {accentStyle === "gradient" && (
                    <input
                      type="color"
                      value={draft.accentTo}
                      onChange={(e) => updateAccent("accentTo", e.target.value)}
                      aria-label="Accent end color"
                      className="color-well absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2 cursor-pointer rounded-full shadow-md"
                    />
                  )}
                </div>
                <div
                  className={`flex font-mono text-[10px] text-fg/40 uppercase ${
                    accentStyle === "gradient"
                      ? "justify-between"
                      : "justify-center"
                  }`}
                >
                  <span>{draft.accentFrom}</span>
                  {accentStyle === "gradient" && <span>{draft.accentTo}</span>}
                </div>
                <p className="text-xs text-fg/40">
                  Colors buttons, highlights &amp; the scene glow.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "design" && (
        <div
          role="tabpanel"
          id="tb-panel-design"
          aria-labelledby="tb-tab-design"
          className="space-y-3"
        >
          <p className="text-xs text-fg/40">
            How cards &amp; panels are drawn — the surface style of your{" "}
            {editMode} theme.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {DESIGNS.map((d) => (
              <OptionCard
                key={d.id}
                selected={designFor(editMode) === d.id}
                onClick={() => setDesign(d.id, editMode)}
                name={d.name}
                desc={d.description}
                title={d.description}
              >
                <span
                  className={`pointer-events-none block ${d.id === "glass" ? "" : `design-${d.id}`}`}
                >
                  <span className="glass-card flex h-10 w-full items-center justify-center">
                    <span
                      className="h-1.5 w-9 rounded-full"
                      style={{
                        backgroundImage: `linear-gradient(to right, ${activeAccent.from}, ${activeAccent.to})`,
                      }}
                      aria-hidden
                    />
                  </span>
                </span>
              </OptionCard>
            ))}
          </div>
        </div>
      )}

      {tab === "scene" && (
        <div
          role="tabpanel"
          id="tb-panel-scene"
          aria-labelledby="tb-tab-scene"
          className="space-y-3"
        >
          <p className="text-xs text-fg/40">
            The animated backdrop behind your {editMode} theme.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {SCENES.map((s) => (
              <OptionCard
                key={s.id}
                selected={sceneFor(editMode) === s.id}
                onClick={() => setScene(s.id, editMode)}
                name={s.name}
                desc={s.description}
                title={s.description}
              >
                <span
                  className="block h-10 w-full overflow-hidden rounded-md ring-1 ring-fg/10"
                  style={{
                    background: scenePreview(s.id, sceneFrom, sceneTo),
                  }}
                  aria-hidden
                />
              </OptionCard>
            ))}
          </div>
        </div>
      )}

      {tab === "font" && (
        <div
          role="tabpanel"
          id="tb-panel-font"
          aria-labelledby="tb-tab-font"
          className="space-y-3"
        >
          <p className="text-xs text-fg/40">
            The interface typeface of your {editMode} theme.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {FONTS.map((f) => (
              <OptionCard
                key={f.id}
                selected={fontFor(editMode) === f.id}
                onClick={() => setFont(f.id, editMode)}
                name={f.name}
                title={f.name}
                nameStyle={{ fontFamily: fontVar(f.id) }}
              >
                <span
                  className="block text-2xl leading-tight text-fg/90"
                  style={{ fontFamily: fontVar(f.id) }}
                  aria-hidden
                >
                  Ag
                </span>
              </OptionCard>
            ))}
          </div>
        </div>
      )}

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
          <p role="status" className="w-full text-xs text-red-400">
            Couldn&apos;t save this theme — your browser is blocking local
            storage (private mode or full storage).
          </p>
        )}
      </div>
    </div>
  );
}
