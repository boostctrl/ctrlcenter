"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { fetchIconSlugs } from "@/lib/icons";

const MAX_RESULTS = 120;

// Searchable browser for the dashboard-icons set, so admins can pick a slug
// instead of memorizing it. Clicking an icon fills the field with its slug.
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetchIconSlugs()
      .then((s) => active && setSlugs(s))
      .catch(() => active && setError(true));
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

  const results = useMemo(() => {
    if (!slugs) return [];
    const q = query.trim().toLowerCase();
    return q ? slugs.filter((s) => s.includes(q)) : slugs;
  }, [slugs, query]);

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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-white/50 transition-colors hover:text-white"
          >
            ✕
          </button>
        </div>

        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons…"
          className="accent-focus w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none transition-colors"
        />

        {error ? (
          <p className="text-sm text-white/50">
            Couldn&apos;t load the icon list. You can still type a slug or image
            URL directly.
          </p>
        ) : !slugs ? (
          <p className="text-sm text-white/50">Loading icons…</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-white/50">No icons match “{query}”.</p>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-6">
              {shown.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  title={slug}
                  onClick={() => {
                    onPick(slug);
                    onClose();
                  }}
                  className="flex flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-2 transition-colors hover:border-white/30 hover:bg-white/[0.06]"
                >
                  <Icon icon={slug} name={slug} size={28} />
                  <span className="w-full truncate text-center text-[10px] text-white/50">
                    {slug}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-white/40">
              Showing {shown.length} of {results.length}
              {results.length > MAX_RESULTS
                ? " — refine your search to narrow it down"
                : ""}
              .
            </p>
          </>
        )}
      </div>
    </div>
  );
}
