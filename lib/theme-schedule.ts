// A day theme and a night theme by time of day (#336): which is current and
// when the next switch is, from sunrise and sunset at the site's weather
// location or from fixed times in the site's time zone. Pure, so the server
// resolves the first paint and the browser the switches after it, with the
// same answer.
import { sunTimes } from "./solar";
import type { ThemePack } from "./theme";
import { packDesign, packScene } from "./theme";

export type ThemeSchedule = {
  enabled: boolean;
  mode: "sun" | "fixed";
  // Gallery pack names; empty = the site's usual theme for that phase.
  day: string;
  night: string;
  // "HH:MM" in the site's time zone, for fixed mode.
  dayStart: string;
  nightStart: string;
  // An appearance mode to go with each phase; unset = the site's.
  dayMode?: "system" | "light" | "dark";
  nightMode?: "system" | "light" | "dark";
};

export type SchedulePhase = "day" | "night";

export type ScheduleState = {
  phase: SchedulePhase;
  // Epoch ms of the next phase change, or null when none is in sight (a
  // polar day or night: re-checked at the next local midnight instead).
  nextSwitch: number | null;
};

const MS_PER_DAY = 86400000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

type Parts = { y: number; m: number; d: number; h: number; min: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      });
    } catch {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
      });
    }
    formatters.set(timeZone, f);
  }
  return f;
}

// The wall-clock date and time at `timeZone` for an instant.
export function zonedParts(at: number, timeZone: string): Parts {
  const out: Parts = { y: 1970, m: 1, d: 1, h: 0, min: 0 };
  for (const p of formatter(timeZone).formatToParts(new Date(at))) {
    const v = parseInt(p.value, 10);
    if (p.type === "year") out.y = v;
    else if (p.type === "month") out.m = v;
    else if (p.type === "day") out.d = v;
    else if (p.type === "hour") out.h = v === 24 ? 0 : v;
    else if (p.type === "minute") out.min = v;
  }
  return out;
}

// The instant at which `timeZone` shows this wall-clock date and time. On a
// spring-forward gap the instant after it; on a fall-back repeat, the first.
export function zonedToUtc(p: Parts, timeZone: string): number {
  const asUtc = (q: Parts) => Date.UTC(q.y, q.m - 1, q.d, q.h, q.min);
  let guess = asUtc(p);
  for (let i = 0; i < 2; i++) {
    const shown = zonedParts(guess, timeZone);
    const diff = asUtc(p) - asUtc(shown);
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

// The calendar date `days` away from a wall-clock date.
function shiftDate(p: Parts, days: number): Parts {
  const t = Date.UTC(p.y, p.m - 1, p.d + days);
  const d = new Date(t);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: 0, min: 0 };
}

function timeOn(p: Parts, hhmm: string, fallback: string): Parts {
  const m = TIME.exec(hhmm) ?? TIME.exec(fallback)!;
  return { ...p, h: parseInt(m[1], 10), min: parseInt(m[2], 10) };
}

type Event = { at: number; to: SchedulePhase };

// The phase now and the next switch, from the schedule's events around the
// current local date (yesterday's, today's and tomorrow's), so the answer is
// right across midnight, a DST change and the poles.
export function scheduleState(
  schedule: Pick<ThemeSchedule, "mode" | "dayStart" | "nightStart">,
  location: { latitude: number; longitude: number },
  timeZone: string,
  now: Date | number = Date.now()
): ScheduleState {
  const t = typeof now === "number" ? now : now.getTime();
  const today = zonedParts(t, timeZone);
  const events: Event[] = [];
  for (const offset of [-1, 0, 1]) {
    const date = shiftDate(today, offset);
    if (schedule.mode === "fixed") {
      events.push({ at: zonedToUtc(timeOn(date, schedule.dayStart, "07:00"), timeZone), to: "day" });
      events.push({ at: zonedToUtc(timeOn(date, schedule.nightStart, "19:00"), timeZone), to: "night" });
    } else {
      const sun = sunTimes(date.y, date.m, date.d, location.latitude, location.longitude);
      if (sun.kind === "normal") {
        events.push({ at: sun.sunrise, to: "day" });
        events.push({ at: sun.sunset, to: "night" });
      } else {
        // The whole local date is one phase, from its midnight.
        events.push({ at: zonedToUtc(date, timeZone), to: sun.day ? "day" : "night" });
      }
    }
  }
  events.sort((a, b) => a.at - b.at);
  let phase: SchedulePhase = "day";
  let found = false;
  for (const e of events) {
    if (e.at <= t) {
      phase = e.to;
      found = true;
    }
  }
  if (!found) phase = events[0]?.to === "day" ? "night" : "day";
  const next = events.find((e) => e.at > t && e.to !== phase);
  let nextSwitch = next ? next.at : null;
  // Nothing ahead (a polar stretch): look again at the next local midnight.
  if (nextSwitch === null) nextSwitch = zonedToUtc(shiftDate(today, 1), timeZone);
  if (nextSwitch - t > 2 * MS_PER_DAY) nextSwitch = t + 2 * MS_PER_DAY;
  return { phase, nextSwitch };
}

// The site theme with a gallery pack applied for a phase (#336): the pack's
// design, scene, colors and parts for both modes, over the rest of the site
// theme (density, scene effects…), and a mode for the phase when set. An
// unknown pack leaves the theme as it is.
export function themeWithPack<
  T extends {
    mode: "system" | "light" | "dark";
    design: string;
    scene: string;
    font: string;
    accentFrom: string;
    accentTo: string;
  },
>(theme: T, pack: ThemePack | undefined, mode?: "system" | "light" | "dark"): T {
  if (!pack) return mode && mode !== theme.mode ? { ...theme, mode } : theme;
  const sameLight = (a: string, b: string) => (a === b ? undefined : b);
  return {
    ...theme,
    mode: mode ?? theme.mode,
    preset: pack.name,
    presetLight: undefined,
    design: pack.design,
    scene: pack.scene,
    designLight: sameLight(pack.design, packDesign(pack, false)),
    sceneLight: sameLight(pack.scene, packScene(pack, false)),
    accentFrom: pack.dark.accentFrom,
    accentTo: pack.dark.accentTo,
    accentFromLight: sameLight(pack.dark.accentFrom, pack.light.accentFrom),
    accentToLight: sameLight(pack.dark.accentTo, pack.light.accentTo),
    background: pack.dark.background,
    foreground: pack.dark.foreground,
    backgroundLight: pack.light.background,
    foregroundLight: pack.light.foreground,
    tune: pack.tune,
    tuneLight: undefined,
    font: pack.font ?? theme.font,
    fontLight: undefined,
    headingFont: pack.headingFont,
    headingFontLight: undefined,
    status: pack.status,
    statusLight: pack.statusLight,
    wallpaper: pack.wallpaper,
    wallpaperLight: pack.wallpaperLight,
  };
}
