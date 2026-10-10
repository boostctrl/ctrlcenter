"use client";

import { useCallback, useEffect, useState } from "react";
import { loadFollowSchedule, saveFollowSchedule } from "@/lib/prefs";
import { scheduleState, type SchedulePhase, type ThemeSchedule } from "@/lib/theme-schedule";
import type { DefaultTheme } from "./useLook";

// What the server resolved for the day/night schedule (#336): the site theme
// for each phase, the phase at render time, and what's needed to find the
// next switch here, so an open page flips without a reload.
export type ScheduleProps = {
  config: ThemeSchedule;
  // The site's usual theme, for a visitor who turned the schedule off.
  base: DefaultTheme;
  day: DefaultTheme;
  night: DefaultTheme;
  phase: SchedulePhase;
  location: { latitude: number; longitude: number };
  timeZone: string;
};

export type ThemeScheduleValue = {
  phase: SchedulePhase;
  // The visitor's switch: follow the site's schedule (default) or keep the
  // site's usual theme under their own choices.
  follow: boolean;
  setFollow: (follow: boolean) => void;
};

const MAX_DELAY = 2 ** 31 - 1;

// The effective site default theme under the schedule: the current phase's
// (re-resolved on a timer at each switch, from the same pure function the
// server used), or the usual one when the visitor opted out.
export function useScheduledTheme(props: ScheduleProps | null): {
  theme: DefaultTheme | null;
  value: ThemeScheduleValue | null;
} {
  const [phase, setPhase] = useState<SchedulePhase>(props?.phase ?? "day");
  const [follow, setFollowState] = useState(true);

  useEffect(() => {
    if (!props) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const st = scheduleState(props.config, props.location, props.timeZone, Date.now());
      setPhase(st.phase);
      const delay = st.nextSwitch === null ? 3600000 : st.nextSwitch - Date.now() + 1000;
      timer = setTimeout(tick, Math.min(MAX_DELAY, Math.max(1000, delay)));
    };
    // The first check runs right away but asynchronously: the server's phase
    // is already painted, and this reconciles it with the browser's clock.
    timer = setTimeout(tick, 0);
    const stored = loadFollowSchedule();
    if (!stored) {
      // Hydrate the visitor's switch from storage after mount (SSR can't
      // know it); the render before it matches the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFollowState(false);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [props]);

  const setFollow = useCallback((next: boolean) => {
    setFollowState(next);
    saveFollowSchedule(next);
  }, []);

  if (!props) return { theme: null, value: null };
  return {
    theme: !follow ? props.base : phase === "day" ? props.day : props.night,
    value: { phase, follow, setFollow },
  };
}
