"use client";

import { useMemo, useState, type DragEvent } from "react";
import type { ThemeGalleryState } from "./useAdminData";
import {
  DESIGNS,
  SCENES,
  DEFAULT_THEME_NAME,
  newThemeEntryKey,
  packDesign,
  packFields,
  packScene,
  resolveThemeGallery,
  uniquePackName,
  type ColorSet,
  type DesignId,
  type ResolvedThemeEntry,
  type SceneId,
  type ThemePack,
} from "@/lib/theme";
import type { ThemeEntryConfig } from "@/lib/schema";
import { FONTS, fontVar, type FontId } from "@/lib/fonts";
import { ChipGroup } from "@/components/ChipGroup";
import { buttonClasses } from "@/lib/buttons";
import { SelectField } from "./ui";
import { apiErrorMessage } from "./apiError";
import { useConfirm } from "./Confirm";
import { TuneFields } from "@/components/theme-builder/TuneFields";
import { WallpaperFields } from "@/components/theme-builder/WallpaperFields";
import { PackPreview } from "@/components/theme-builder/PackPreview";
import { useAutosave, SaveStatus, type SaveOptions } from "./useAutosave";

async function saveThemes(entries: ThemeEntryConfig[], opts?: SaveOptions): Promise<void> {
  const res = await fetch("/api/themes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entries),
    keepalive: opts?.keepalive,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(apiErrorMessage(data, "Failed to save themes"));
  }
}

const colorClass =
  "h-8 w-8 shrink-0 cursor-pointer rounded border border-fg/10 bg-transparent";

const COLOR_FIELDS: { key: keyof ColorSet; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text & surfaces" },
  { key: "accentFrom", label: "Accent start" },
  { key: "accentTo", label: "Accent end" },
];

// The stored list with every pack in the gallery present (#334): the entries
// as they are, plus a bare reference for each built-in the list didn't
// mention, in the gallery's order — so a move, hide or edit of any pack has
// an entry to land on and the order is written out whole.
function materialize(gallery: ResolvedThemeEntry[]): ThemeEntryConfig[] {
  return gallery.map((r) =>
    r.entry ? { ...r.entry, key: r.key, builtin: r.builtin } : { key: r.key, builtin: r.builtin }
  );
}

export default function ThemesManager({
  themes,
}: {
  // Held by the admin page, so Settings' theme pickers show edits made here
  // (#317).
  themes: ThemeGalleryState;
}) {
  const { entries, setEntries } = themes;
  // Edits debounce-save automatically (local state stays authoritative).
  const { status, error } = useAutosave(entries, saveThemes);
  const confirm = useConfirm();
  const gallery = useMemo(() => resolveThemeGallery(entries), [entries]);
  const [dragKey, setDragKey] = useState<string | null>(null);

  // Every mutation works on the materialized list, keyed by entry key.
  function mutate(fn: (list: ThemeEntryConfig[], gallery: ResolvedThemeEntry[]) => ThemeEntryConfig[]) {
    setEntries((prev) => {
      const g = resolveThemeGallery(prev);
      return fn(materialize(g), g);
    });
  }

  // Patch one pack's fields. A built-in still as shipped is copied whole
  // first, so the entry is a complete pack from then on (and a cleared
  // optional part stays cleared, see resolveThemeGallery).
  function setPack(key: string, patch: Partial<ThemePack>) {
    mutate((list, g) =>
      list.map((e, i) => {
        if (e.key !== key) return e;
        const r = g[i];
        const base = r.edited ? e : { ...e, ...packFields(r.pack) };
        return { ...base, ...patch };
      })
    );
  }

  function setColor(key: string, mode: "dark" | "light", field: keyof ColorSet, value: string) {
    mutate((list, g) =>
      list.map((e, i) => {
        if (e.key !== key) return e;
        const r = g[i];
        const base = r.edited ? e : { ...e, ...packFields(r.pack) };
        const cs = base[mode] ?? r.pack[mode];
        return { ...base, [mode]: { ...cs, [field]: value } };
      })
    );
  }

  // Confirmed: discards every customization of the pack at once, with no undo
  // (aligned with the visitor-side destructive actions, #121). The entry
  // keeps its place and its hidden state.
  async function resetPack(r: ResolvedThemeEntry) {
    const ok = await confirm({
      title: `Reset “${r.pack.name}”?`,
      message: "Restores the built-in theme, discarding your edits to it.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (!ok) return;
    mutate((list) =>
      list.map((e) =>
        e.key === r.key ? { key: e.key, builtin: e.builtin, ...(e.hidden ? { hidden: true } : {}) } : e
      )
    );
  }

  async function deletePack(r: ResolvedThemeEntry) {
    const ok = await confirm({
      title: `Delete “${r.pack.name}”?`,
      message:
        "Visitors who applied it keep their copy; the site's default theme, if it was this one, keeps its colors but no longer names it.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    mutate((list) => list.filter((e) => e.key !== r.key));
  }

  function setHidden(key: string, hidden: boolean) {
    mutate((list) =>
      list.map((e) => {
        if (e.key !== key) return e;
        const { hidden: _drop, ...rest } = e;
        void _drop;
        return hidden ? { ...rest, hidden: true } : rest;
      })
    );
  }

  // A copy of the pack as it is now, as a theme of the admin's own, right
  // after it.
  function duplicatePack(r: ResolvedThemeEntry) {
    mutate((list, g) => {
      const i = list.findIndex((e) => e.key === r.key);
      const copy: ThemeEntryConfig = {
        key: newThemeEntryKey(),
        ...packFields(r.pack),
        name: uniquePackName(`${r.pack.name} copy`, g.map((x) => x.pack.name)),
      };
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
    });
  }

  // A new theme, starting from the stock look, at the end.
  function addPack() {
    mutate((list, g) => {
      const stock = g.find((x) => x.builtin === DEFAULT_THEME_NAME)?.pack ?? g[0].pack;
      const entry: ThemeEntryConfig = {
        key: newThemeEntryKey(),
        ...packFields(stock),
        name: uniquePackName("New theme", g.map((x) => x.pack.name)),
      };
      return [...list, entry];
    });
  }

  function move(key: string, to: number) {
    mutate((list) => {
      const from = list.findIndex((e) => e.key === key);
      if (from < 0 || to < 0 || to >= list.length || from === to) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function onDrop(e: DragEvent, targetKey: string) {
    e.preventDefault();
    const key = dragKey ?? e.dataTransfer.getData("text/plain");
    setDragKey(null);
    if (!key || key === targetKey) return;
    const to = gallery.findIndex((r) => r.key === targetKey);
    if (to >= 0) move(key, to);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-50">
          The themes visitors can pick in the theme builder, in this order.
          Edit a built-in or reset it to its original, add themes of your own,
          hide any from visitors, and drag or use the arrows to reorder.
          Changes apply site-wide.
        </p>
        <div className="flex items-center gap-3">
          <SaveStatus status={status} error={error} />
          <button type="button" onClick={addPack} className={buttonClasses("primary", "sm")}>
            Add theme
          </button>
        </div>
      </div>

      {/* Three across once the shell affords it (#161) — pack cards are
          compact editors that read fine at ~430px. */}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {gallery.map((r, i) => (
          <li
            key={r.key}
            onDragOver={(e) => {
              if (dragKey && dragKey !== r.key) e.preventDefault();
            }}
            onDrop={(e) => onDrop(e, r.key)}
            className={dragKey === r.key ? "opacity-50" : undefined}
          >
            <PackEditor
              entry={r}
              index={i}
              count={gallery.length}
              dragging={dragKey !== null}
              onDragStart={(e) => {
                setDragKey(r.key);
                e.dataTransfer.setData("text/plain", r.key);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragKey(null)}
              onField={(patch) => setPack(r.key, patch)}
              onColor={(mode, key, value) => setColor(r.key, mode, key, value)}
              onMove={(to) => move(r.key, to)}
              onHidden={(hidden) => setHidden(r.key, hidden)}
              onDuplicate={() => duplicatePack(r)}
              onReset={() => resetPack(r)}
              onDelete={() => deletePack(r)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PackEditor({
  entry: r,
  index,
  count,
  dragging,
  onDragStart,
  onDragEnd,
  onField,
  onColor,
  onMove,
  onHidden,
  onDuplicate,
  onReset,
  onDelete,
}: {
  entry: ResolvedThemeEntry;
  index: number;
  count: number;
  dragging: boolean;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
  onField: (patch: Partial<ThemePack>) => void;
  onColor: (mode: "dark" | "light", key: keyof ColorSet, value: string) => void;
  onMove: (to: number) => void;
  onHidden: (hidden: boolean) => void;
  onDuplicate: () => void;
  onReset: () => void;
  onDelete: () => void;
}) {
  const pack = r.pack;
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const cs = pack[mode];
  const isBuiltin = r.builtin !== undefined;
  const isStock = r.builtin === DEFAULT_THEME_NAME;
  const idBase = `pack-${r.key.replace(/\W+/g, "-")}`;
  const iconButton =
    "shrink-0 rounded-md px-1.5 py-1 text-xs text-ink-50 transition-colors hover:bg-fg/10 hover:text-ink-80 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className={`glass-card flex flex-col gap-3 p-4 ${r.hidden ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-1.5">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Drag to reorder"
          aria-hidden
          className={`cursor-grab select-none text-ink-40 ${dragging ? "cursor-grabbing" : ""}`}
        >
          ⋮⋮
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={pack.name}
            onChange={(e) => onField({ name: e.target.value.slice(0, 40) })}
            aria-label="Theme name"
            className="accent-focus min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 font-semibold text-fg outline-none transition-colors hover:border-fg/15 focus:border-fg/25 focus:bg-fg/5"
          />
          {isStock && (
            <span className="shrink-0 rounded bg-fg/15 px-1 text-[9px] font-medium tracking-wide text-ink-70 uppercase">
              Default
            </span>
          )}
          {r.hidden && (
            <span className="shrink-0 rounded bg-fg/15 px-1 text-[9px] font-medium tracking-wide text-ink-70 uppercase">
              Hidden
            </span>
          )}
          {isBuiltin && r.edited && <span className="shrink-0 text-xs text-ink-40">· edited</span>}
          {!isBuiltin && <span className="shrink-0 text-xs text-ink-40">· yours</span>}
        </div>
        <button
          type="button"
          onClick={() => onMove(index - 1)}
          disabled={index === 0}
          aria-label={`Move ${pack.name} up`}
          title="Move up"
          className={iconButton}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMove(index + 1)}
          disabled={index === count - 1}
          aria-label={`Move ${pack.name} down`}
          title="Move down"
          className={iconButton}
        >
          ↓
        </button>
      </div>

      {/* The pack as visitors will see it, for the mode being edited (#334). */}
      <PackPreview pack={pack} mode={mode} />

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <button type="button" onClick={() => onHidden(!r.hidden)} className={buttonClasses("ghost", "sm")}>
          {r.hidden ? "Show to visitors" : "Hide from visitors"}
        </button>
        <button type="button" onClick={onDuplicate} className={buttonClasses("ghost", "sm")}>
          Duplicate
        </button>
        {isBuiltin && r.edited && (
          <button type="button" onClick={onReset} className={buttonClasses("ghost", "sm")}>
            Reset
          </button>
        )}
        {!isBuiltin && (
          <button type="button" onClick={onDelete} className={`${buttonClasses("ghost", "sm")} hover:text-status-down`}>
            Delete
          </button>
        )}
      </div>

      <ChipGroup
        label="Editing mode"
        equal
        capitalize
        options={(["dark", "light"] as const).map((m) => ({
          value: m,
          label: m,
        }))}
        value={mode}
        onChange={setMode}
      />

      {/* Design and scene for the mode being edited: light can diverge from
          dark (#334); setting light to the same as dark folds it back. */}
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Design"
          value={packDesign(pack, mode === "dark")}
          onChange={(e) => {
            const design = e.target.value as DesignId;
            onField(
              mode === "dark"
                ? { design }
                : { designLight: design === pack.design ? undefined : design }
            );
          }}
        >
          {DESIGNS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Scene"
          value={packScene(pack, mode === "dark")}
          onChange={(e) => {
            const scene = e.target.value as SceneId;
            onField(
              mode === "dark" ? { scene } : { sceneLight: scene === pack.scene ? undefined : scene }
            );
          }}
        >
          {SCENES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {COLOR_FIELDS.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-xs">
            <input
              type="color"
              value={cs[f.key]}
              onChange={(e) => onColor(mode, f.key, e.target.value)}
              aria-label={`${pack.name} ${mode} ${f.label}`}
              className={colorClass}
            />
            <span className="text-ink-60">{f.label}</span>
          </label>
        ))}
      </div>

      {/* Fonts a pack may carry (#330); "Visitor's choice" leaves them alone. */}
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Font"
          value={pack.font ?? ""}
          onChange={(e) => onField({ font: (e.target.value || undefined) as FontId | undefined })}
          style={pack.font ? { fontFamily: fontVar(pack.font) } : undefined}
        >
          <option value="">Visitor&apos;s choice</option>
          {FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: fontVar(f.id) }}>
              {f.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Heading font"
          value={pack.headingFont ?? ""}
          onChange={(e) =>
            onField({ headingFont: (e.target.value || undefined) as FontId | undefined })
          }
          style={pack.headingFont ? { fontFamily: fontVar(pack.headingFont) } : undefined}
        >
          <option value="">Visitor&apos;s choice</option>
          {FONTS.map((f) => (
            <option key={f.id} value={f.id} style={{ fontFamily: fontVar(f.id) }}>
              {f.name}
            </option>
          ))}
        </SelectField>
      </div>

      {/* The pack's fine-tune over its design (#326), both modes. */}
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-50 transition-colors hover:text-ink-80">
          Fine-tune the design{pack.tune ? " · adjusted" : ""}
        </summary>
        <div className="mt-2">
          <TuneFields
            value={pack.tune ?? null}
            onChange={(tune) => onField({ tune: tune ?? undefined })}
            idPrefix={idBase}
            compact
          />
        </div>
      </details>

      {/* The pack's wallpaper (#333), per mode. */}
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-50 transition-colors hover:text-ink-80">
          Wallpaper{(mode === "dark" ? pack.wallpaper : pack.wallpaperLight) ? " · set" : ""}
        </summary>
        <div className="mt-2">
          <WallpaperFields
            value={(mode === "dark" ? pack.wallpaper : pack.wallpaperLight) ?? null}
            onChange={(wp) =>
              onField(mode === "dark" ? { wallpaper: wp ?? undefined } : { wallpaperLight: wp ?? undefined })
            }
            idPrefix={`${idBase}-${mode}-wallpaper`}
            canUpload
            compact
          />
        </div>
      </details>
    </div>
  );
}
