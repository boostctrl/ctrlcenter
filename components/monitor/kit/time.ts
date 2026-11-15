"use client";

import { useSyncExternalStore } from "react";

// Labels that depend on the viewer's clock and time zone render only after
// mount (the server has neither), so they can't mismatch on hydration.
const subscribeNever = () => () => {};
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
}

const DAY = 86_400_000;
const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

// Whole calendar days from `now` to `at` in the viewer's zone: 0 today, 1
// tomorrow, -1 yesterday.
export function daysFrom(at: number, now: number): number {
  return Math.round((startOfDay(at) - startOfDay(now)) / DAY);
}

// "5m ago", "3h ago", "2d ago".
export function ago(at: number, now: number): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 14 ? `${days}d ago` : `${Math.round(days / 7)}w ago`;
}

// "Today", "Tomorrow", a weekday within the week, else "Nov 21".
export function dayName(at: number, now: number): string {
  const days = daysFrom(at, now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  const d = new Date(at);
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// "9:00 PM", in the viewer's own clock style.
export function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
