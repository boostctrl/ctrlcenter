"use client";

import { useEffect, useRef, useState } from "react";

type Result = {
  id: number;
  name: string;
  admin1?: string;
  country_code?: string;
  latitude: number;
  longitude: number;
};

function label(r: Result): string {
  return [r.name, r.admin1, r.country_code].filter(Boolean).join(", ");
}

// City search via Open-Meteo's geocoding API, so a weather location can be set
// by name instead of raw coordinates. Used by the admin default-location field
// and the visitor Preferences card; `label` is the display name of the pick
// ("City, Region, CC") for callers that store one.
export default function CitySearch({
  onSelect,
}: {
  onSelect: (latitude: number, longitude: number, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      try {
        const res = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
            q
          )}&count=5`,
          { signal: controller.signal }
        );
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
        setOpen(true);
      } catch {
        // Aborted or offline — leave the previous results.
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search a city…"
        className="accent-focus w-full rounded-lg border border-fg/10 bg-fg/5 px-3 py-2 text-fg outline-none transition-colors"
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-fg/10 bg-[var(--background)] shadow-lg">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                onSelect(r.latitude, r.longitude, label(r));
                setQuery(label(r));
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-fg/80 transition-colors hover:bg-fg/10"
            >
              {label(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
