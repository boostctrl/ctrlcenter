"use client";

// Each widget's editor in admin Settings → Widgets (#285), keyed by widget id
// beside the widget registry (lib/widgets/defs.ts). Listed in the order the
// cards appear; WidgetsSection renders them in turn. Widgets without settings
// (greeting, favorites, …) have no entry.
import type { ComponentType } from "react";
import type { LayoutWidgetId } from "@/lib/layout";
import type { SettingsDraft } from "../useSettingsDraft";
import SearchSettings from "./SearchSettings";
import WeatherSettings from "./WeatherSettings";
import CalendarSettings from "./CalendarSettings";
import FeedSettings from "./FeedSettings";
import NotesSettings from "./NotesSettings";
import CountdownSettings from "./CountdownSettings";
import WorldClocksSettings from "./WorldClocksSettings";
import SystemStatsSettings from "./SystemStatsSettings";

export const WIDGET_SETTINGS: Partial<Record<LayoutWidgetId, ComponentType<{ d: SettingsDraft }>>> = {
  search: SearchSettings,
  weather: WeatherSettings,
  calendar: CalendarSettings,
  feed: FeedSettings,
  notes: NotesSettings,
  countdown: CountdownSettings,
  worldClocks: WorldClocksSettings,
  systemStats: SystemStatsSettings,
};
