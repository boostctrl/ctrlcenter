"use client";

import { useCallback, useEffect, useRef } from "react";

// One polling loop for the client components that refresh on a timer (#286) —
// the status pages, the Monitor, the weather widgets — instead of each
// hand-rolling setInterval:
// - runs `task` on mount (unless `immediate: false`, for pages seeded with
//   server data, which skips only that first run) and every `intervalMs`
//   after that;
// - pauses while the tab is hidden, and on return runs right away if the last
//   run is a full interval old (a quick tab flick doesn't refetch);
// - hands each run an AbortSignal, aborted when the next run starts, when the
//   task changes and on unmount, so a slow response can't land late over newer
//   data;
// - re-runs immediately when `task` changes (memoize it with useCallback; its
//   deps — a time zone, a location — are what should trigger a reload).
//
// Returns `refresh`, which runs the task now (e.g. after a write) through the
// same abort bookkeeping. Tasks own their errors; a rejection is swallowed.
export type PollTask = (signal: AbortSignal) => Promise<unknown> | void;

export function usePolling(
  task: PollTask,
  intervalMs: number,
  { enabled = true, immediate = true }: { enabled?: boolean; immediate?: boolean } = {}
): () => Promise<void> {
  const taskRef = useRef(task);
  const controller = useRef<AbortController | null>(null);
  const lastRun = useRef(0);
  // The task the loop last started with: `immediate: false` skips the run
  // for the seeded first task only, and a changed task always runs at once
  // (#472). A ref, not a mount flag, so StrictMode's dev-only remount with
  // the same task doesn't fetch over the seed either.
  const startedWith = useRef<PollTask | null>(null);
  useEffect(() => {
    taskRef.current = task;
  });

  const run = useCallback(async () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    lastRun.current = Date.now();
    try {
      await taskRef.current(c.signal);
    } catch {
      // Aborted, or a task that didn't catch its own failure — either way the
      // previous data stays and the next tick tries again.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      clearInterval(timer);
      timer = setInterval(() => void run(), intervalMs);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) return stop();
      if (Date.now() - lastRun.current >= intervalMs) void run();
      start();
    };
    const changed = startedWith.current !== null && startedWith.current !== task;
    startedWith.current = task;
    if (immediate || changed) void run();
    else lastRun.current = Date.now();
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      controller.current?.abort();
    };
  }, [task, intervalMs, enabled, immediate, run]);

  return run;
}
