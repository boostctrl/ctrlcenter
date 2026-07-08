"use client";

import { useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

// Passed to `save` when the hook flushes a still-debouncing edit as the
// component or page goes away. Fetch-based savers should forward `keepalive`
// to fetch so the browser finishes the request even after the page unloads
// (keepalive bodies are limited to 64 KB, so it's only set on flushes).
export type SaveOptions = { keepalive?: boolean };

// Debounced autosave for the admin forms. Watches `value` (serialized, so only
// real content changes fire and identical re-renders don't), skips the initial
// server-provided value, and runs `save` after `delay` ms of quiet. It never
// writes back into the caller's state, so there's no save loop — the local form
// state stays authoritative.
export function useAutosave<T>(
  value: T,
  save: (value: T, opts?: SaveOptions) => Promise<void>,
  delay = 600
): { status: SaveState; error: string | null } {
  const [status, setStatus] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Only real content changes should trigger a save (and identical re-renders
  // shouldn't), so key the effect on the serialized value.
  const key = JSON.stringify(value);
  // The serialization the server is already assumed to have: the initial
  // server-provided value, then each scheduled save's payload. Saving only when
  // `key` departs from it makes mount runs no-ops — including StrictMode's dev
  // replay, which used to consume a one-shot "skip the first run" flag and then
  // save the untouched initial value on the replay (#73). It also keeps
  // reverting-to-initial saving correctly: once an edit is scheduled the
  // snapshot moves with it, so a later revert still differs and writes.
  const savedKey = useRef(key);
  // Serialize the actual writes so two saves can never land out of order (an
  // older value clobbering a newer one when the first request is slower than the
  // debounce window), and a monotonic sequence so only the latest save drives the
  // visible status.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const latestSeq = useRef(0);
  // The edit still waiting out the debounce, if any, so it can be flushed when
  // the component unmounts or the page unloads instead of being dropped (#103).
  const pending = useRef<{ value: T } | null>(null);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    if (key === savedKey.current) return;
    savedKey.current = key;
    let cancelled = false;
    const seq = ++latestSeq.current;
    pending.current = { value };
    setStatus("saving");
    setError(null);
    const t = setTimeout(() => {
      // Committed to the chain now — the flush no longer needs to cover it.
      pending.current = null;
      // `.catch` first so a prior failed save never blocks the next one, then run
      // this save after the previous one has fully settled (preserving order).
      chain.current = chain.current.catch(() => undefined).then(async () => {
        try {
          await save(value);
          if (!cancelled && seq === latestSeq.current) setStatus("saved");
        } catch (e) {
          if (!cancelled && seq === latestSeq.current) {
            setStatus("error");
            setError(e instanceof Error ? e.message : "Couldn't save");
          }
        }
      });
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // `save`/`value`/`delay` are intentionally read via closure; `key` captures
    // value changes and the save fns are stable (module-level).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Flush an edit still inside the debounce window when the component goes away
  // (in-app navigation) or the page unloads (tab close, reload) — otherwise the
  // last edit is silently dropped while the status may still read "Saving…".
  // The flush goes through the chain too, so it can never race ahead of an
  // in-flight older save; fire-and-forget since there's nothing left to notify.
  useEffect(() => {
    const flush = () => {
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      chain.current = chain.current
        .catch(() => undefined)
        .then(() => saveRef.current(p.value, { keepalive: true }))
        .catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

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
