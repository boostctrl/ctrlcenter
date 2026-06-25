"use client";

import { useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

// Debounced autosave for the admin forms. Watches `value` (serialized, so only
// real content changes fire and identical re-renders don't), skips the initial
// server-provided value, and runs `save` after `delay` ms of quiet. It never
// writes back into the caller's state, so there's no save loop — the local form
// state stays authoritative.
export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<void>,
  delay = 600
): { status: SaveState; error: string | null } {
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Only real content changes should trigger a save (and identical re-renders
  // shouldn't), so key the effect on the serialized value.
  const key = JSON.stringify(value);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let cancelled = false;
    setStatus("saving");
    setError(null);
    const t = setTimeout(async () => {
      try {
        await save(value);
        if (!cancelled) setStatus("saved");
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Couldn't save");
        }
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // `save`/`value`/`delay` are intentionally read via closure; `key` captures
    // value changes and the save fns are stable (module-level).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { status, error };
}

// A subtle inline indicator for the autosave state.
export function SaveStatus({
  status,
  error,
}: {
  status: SaveState;
  error: string | null;
}) {
  if (status === "idle") return null;
  const text =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : `Couldn't save${error ? ` — ${error}` : ""}`;
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 text-xs ${
        status === "error" ? "text-red-400" : "text-fg/45"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          status === "saving"
            ? "bg-amber-400"
            : status === "saved"
              ? "bg-emerald-400"
              : "bg-red-400"
        }`}
        aria-hidden
      />
      {text}
    </span>
  );
}
