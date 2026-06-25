"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { fetchIconSlugs } from "@/lib/icons";

const MAX_RESULTS = 120;

type UploadedIcon = { name: string; url: string };

const UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.svg,.ico,image/*";

// Searchable browser for the dashboard-icons set plus the admin's own uploaded
// icons, so admins can pick a slug (or a custom image) instead of memorizing it.
// Clicking an icon fills the field with its slug or served URL.
export default function IconPicker({
  onPick,
  onClose,
}: {
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const [slugs, setSlugs] = useState<string[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [uploaded, setUploaded] = useState<UploadedIcon[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetchIconSlugs()
      .then((s) => active && setSlugs(s))
      .catch(() => active && setError(true));
    fetch("/api/icons")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => active && setUploaded(Array.isArray(list) ? list : []))
      .catch(() => {});
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      active = false;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function handleUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/icons", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Upload failed");
      }
      onPick(data.url);
      onClose();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(name: string) {
    setUploaded((prev) => prev.filter((u) => u.name !== name));
    await fetch(`/api/icons?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!slugs) return [];
    return q ? slugs.filter((s) => s.includes(q)) : slugs;
  }, [slugs, q]);
  const shownUploaded = q
    ? uploaded.filter((u) => u.name.toLowerCase().includes(q))
    : uploaded;

  const shown = results.slice(0, MAX_RESULTS);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-label="Choose an icon"
    >
      <div
        className="glass-card flex max-h-[70vh] w-full max-w-2xl flex-col gap-4 p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-semibold">Choose an icon</h3>
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              aria-label="Upload icon image"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-fg/10 bg-fg/5 px-3 py-1.5 text-xs text-fg/80 transition-colors hover:bg-fg/10 disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Upload image"}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-fg/50 transition-colors hover:text-fg"
            >
              ✕
            </button>
          </div>
        </div>

        {uploadError && <p className="text-sm text-red-400">{uploadError}</p>}

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons…"
          className="accent-focus w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors"
        />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {shownUploaded.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium tracking-wide text-fg/45 uppercase">
                Your icons
              </span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {shownUploaded.map((u) => (
                  <div key={u.name} className="group relative">
                    <button
                      type="button"
                      title={u.name}
                      onClick={() => {
                        onPick(u.url);
                        onClose();
                      }}
                      className="flex w-full flex-col items-center gap-1 rounded-lg border border-fg/10 bg-fg/[0.03] p-2 transition-colors hover:border-fg/30 hover:bg-fg/[0.06]"
                    >
                      <Icon icon={u.url} name={u.name} size={28} />
                      <span className="w-full truncate text-center text-[10px] text-fg/50">
                        {u.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(u.name)}
                      aria-label={`Delete ${u.name}`}
                      className="absolute top-1 right-1 rounded-md bg-background/70 px-1 text-xs text-fg/50 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error ? (
            <p className="text-sm text-fg/50">
              Couldn&apos;t load the icon list. You can still type a slug or image
              URL directly, or upload an image above.
            </p>
          ) : !slugs ? (
            <p className="text-sm text-fg/50">Loading icons…</p>
          ) : results.length === 0 && shownUploaded.length === 0 ? (
            <p className="text-sm text-fg/50">No icons match “{query}”.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {shownUploaded.length > 0 && (
                <span className="text-xs font-medium tracking-wide text-fg/45 uppercase">
                  Icon library
                </span>
              )}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {shown.map((slug) => (
                  <button
                    key={slug}
                    type="button"
                    title={slug}
                    onClick={() => {
                      onPick(slug);
                      onClose();
                    }}
                    className="flex flex-col items-center gap-1 rounded-lg border border-fg/10 bg-fg/[0.03] p-2 transition-colors hover:border-fg/30 hover:bg-fg/[0.06]"
                  >
                    <Icon icon={slug} name={slug} size={28} />
                    <span className="w-full truncate text-center text-[10px] text-fg/50">
                      {slug}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-fg/40">
                Showing {shown.length} of {results.length}
                {results.length > MAX_RESULTS
                  ? " — refine your search to narrow it down"
                  : ""}
                .
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
