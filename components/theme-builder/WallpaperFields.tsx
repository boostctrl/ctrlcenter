"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_WALLPAPER_BLUR,
  WALLPAPER_FITS,
  isWallpaperSrc,
  type Wallpaper,
  type WallpaperFit,
} from "@/lib/theme";
import { buttonClasses } from "@/lib/buttons";
import { ChipGroup } from "../ChipGroup";

// The wallpaper controls (#333), shared by the theme builder's Scene tab, the
// admin pack editor and Settings → General: an image address (typed, or for
// an admin, uploaded), blur, dim and fit. `value` null means no wallpaper. The
// address commits on blur or Enter, not per keystroke, so the page doesn't
// fetch every partial URL.
export function WallpaperFields({
  value,
  onChange,
  idPrefix,
  canUpload = false,
  compact = false,
}: {
  value: Wallpaper | null;
  onChange: (wallpaper: Wallpaper | null) => void;
  idPrefix: string;
  canUpload?: boolean;
  compact?: boolean;
}) {
  const [src, setSrc] = useState(value?.src ?? "");
  const [srcError, setSrcError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Follow an outside change (a theme restored, a pack applied) into the box.
  const outside = value?.src ?? "";
  const lastOutside = useRef(outside);
  useEffect(() => {
    if (lastOutside.current !== outside) {
      lastOutside.current = outside;
      setSrc(outside);
      setSrcError(null);
    }
  }, [outside]);

  const wp: Wallpaper = value ?? { src: "", blur: 0, dim: 0, fit: "cover" };
  const commitSrc = () => {
    const next = src.trim();
    if (!next) {
      setSrcError(null);
      if (value) onChange(null);
      return;
    }
    if (!isWallpaperSrc(next)) {
      setSrcError("Use an https:// image address or an upload.");
      return;
    }
    setSrcError(null);
    if (next !== value?.src) onChange({ ...wp, src: next });
  };
  const patch = (p: Partial<Wallpaper>) => {
    if (!value) return;
    onChange({ ...value, ...p });
  };

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/wallpapers", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      setSrc(data.url);
      setSrcError(null);
      onChange({ ...wp, src: data.url });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const labelClass = compact ? "text-xs text-ink-60" : "text-[11px] font-medium text-ink-55";
  const srcId = `${idPrefix}-src`;
  return (
    <div className={compact ? "space-y-2" : "grid gap-x-6 gap-y-3 sm:grid-cols-2"}>
      <div className={compact ? "space-y-1" : "space-y-1 sm:col-span-2"}>
        <label htmlFor={srcId} className={labelClass}>
          Image
        </label>
        <div className="flex gap-2">
          <input
            id={srcId}
            type="url"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            onBlur={commitSrc}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitSrc();
              }
            }}
            placeholder="https://… or none"
            spellCheck={false}
            aria-invalid={srcError ? true : undefined}
            aria-describedby={srcError ? `${srcId}-error` : `${srcId}-desc`}
            className="accent-focus min-w-0 flex-1 rounded-lg border border-fg/10 bg-fg/5 px-2.5 py-1.5 text-xs text-fg outline-none transition-colors placeholder:text-ink-40"
          />
          {canUpload && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUpload(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className={buttonClasses("ghost", "sm")}
              >
                {uploading ? "Uploading…" : "Upload"}
              </button>
            </>
          )}
        </div>
        {srcError ? (
          <p id={`${srcId}-error`} role="alert" className="text-[10px] text-status-down">
            {srcError}
          </p>
        ) : uploadError ? (
          <p role="alert" className="text-[10px] text-status-down">
            {uploadError}
          </p>
        ) : (
          !compact && (
            <p id={`${srcId}-desc`} className="text-[10px] text-ink-40">
              A photo behind the scene{canUpload ? ": a web address, or upload a PNG, JPEG or WebP up to 4 MB" : ", by its web address"}.
            </p>
          )
        )}
      </div>
      {value && (
        <>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`${idPrefix}-blur`} className={labelClass}>
                Blur
              </label>
              <output htmlFor={`${idPrefix}-blur`} className="font-mono text-[10px] text-ink-40 tabular-nums">
                {wp.blur}px
              </output>
            </div>
            <input
              id={`${idPrefix}-blur`}
              type="range"
              min={0}
              max={MAX_WALLPAPER_BLUR}
              step={2}
              value={wp.blur}
              onChange={(e) => patch({ blur: Number(e.target.value) })}
              className="tune-range w-full"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`${idPrefix}-dim`} className={labelClass}>
                Dim
              </label>
              <output htmlFor={`${idPrefix}-dim`} className="font-mono text-[10px] text-ink-40 tabular-nums">
                {wp.dim}%
              </output>
            </div>
            <input
              id={`${idPrefix}-dim`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={wp.dim}
              onChange={(e) => patch({ dim: Number(e.target.value) })}
              className="tune-range w-full"
            />
            {!compact && (
              <p className="text-[10px] text-ink-40">Fades the image toward the page color so cards stay readable.</p>
            )}
          </div>
          <div className={compact ? "flex flex-wrap items-center gap-2" : "flex flex-wrap items-center gap-3 sm:col-span-2"}>
            <ChipGroup
              label="Wallpaper fit"
              size="xs"
              fit
              options={WALLPAPER_FITS.map((f) => ({ value: f.id, label: f.name }))}
              value={wp.fit}
              onChange={(fit: WallpaperFit) => patch({ fit })}
            />
            <button
              type="button"
              onClick={() => {
                setSrc("");
                setSrcError(null);
                onChange(null);
              }}
              className={buttonClasses("ghost", "sm")}
            >
              Remove wallpaper
            </button>
          </div>
        </>
      )}
    </div>
  );
}
