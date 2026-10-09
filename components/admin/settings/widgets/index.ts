"use client";

// The admin Settings → Widgets editors (#285), beside the widget registry
// (lib/widgets/defs.ts). Two kinds:
// - site settings that some widgets read (search engine and bangs, the
//   weather location), one card each;
// - per-instance editors for the content widgets (#297): WidgetsSection lists
//   each type's instances, every one with its own editor, show switch and
//   Remove, and an Add button for another.
// Widgets without settings (greeting, favorites, …) have no entry.
import type { ComponentType } from "react";
import type { WidgetType } from "@/lib/layout";
import type { InstanceOf } from "@/lib/schema";
import type { FeedHealth } from "@/lib/feed";
import type { SettingsDraft } from "../useSettingsDraft";
import SearchSettings from "./SearchSettings";
import WeatherSettings from "./WeatherSettings";
import CalendarSettings from "./CalendarSettings";
import FeedSettings from "./FeedSettings";
import NotesSettings from "./NotesSettings";
import CountdownSettings from "./CountdownSettings";
import WorldClocksSettings from "./WorldClocksSettings";
import SystemStatsSettings from "./SystemStatsSettings";

export const SITE_SETTINGS: ComponentType<{ d: SettingsDraft }>[] = [SearchSettings, WeatherSettings];

export type InstanceEditorProps<T extends WidgetType> = {
  w: InstanceOf<T>;
  // What the admin calls this instance, for row labels.
  label: string;
  onChange: (patch: Partial<InstanceOf<T>>) => void;
  // Fetch health for the RSS feeds' URLs (read by the feed editor only).
  feedHealth?: Record<string, FeedHealth> | null;
};

export type InstanceGroup = {
  type: WidgetType;
  title: string;
  intro: string;
  add: string;
  // Typed loosely here; each editor is typed to its own instance.
  Editor: ComponentType<InstanceEditorProps<never>>;
};

const group = <T extends WidgetType>(
  g: Omit<InstanceGroup, "Editor"> & { type: T; Editor: ComponentType<InstanceEditorProps<T>> }
): InstanceGroup => g as unknown as InstanceGroup;

export const INSTANCE_GROUPS: InstanceGroup[] = [
  group({
    type: "calendar",
    title: "Calendars",
    intro:
      "Upcoming events from a published iCal (.ics) URL, or a private CalDAV/WebDAV calendar (e.g. a Nextcloud DAV URL) with credentials.",
    add: "+ Add calendar",
    Editor: CalendarSettings,
  }),
  group({
    type: "feed",
    title: "RSS feeds",
    intro:
      "The latest entries from one or more RSS, Atom, or JSON feeds, merged newest-first. Fetched server-side and cached for a few minutes.",
    add: "+ Add feed card",
    Editor: FeedSettings,
  }),
  group({
    type: "notes",
    title: "Notes",
    intro: "Free-form note cards, written in markdown.",
    add: "+ Add notes card",
    Editor: NotesSettings,
  }),
  group({
    type: "countdown",
    title: "Countdowns",
    intro: "Labeled dates shown as “in N days” rows — renewals, birthdays, deadlines.",
    add: "+ Add countdown",
    Editor: CountdownSettings,
  }),
  group({
    type: "worldClocks",
    title: "World clocks",
    intro: "Live clocks for the time zones you follow.",
    add: "+ Add world clocks card",
    Editor: WorldClocksSettings,
  }),
  group({
    type: "systemStats",
    title: "System stats",
    intro:
      "CPU, memory and disk usage of whatever runs the app. The card says whether it's measuring this container or the host machine.",
    add: "+ Add system stats card",
    Editor: SystemStatsSettings,
  }),
];
