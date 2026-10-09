// What the home page hands the widgets (#285): one object, built on the
// server by lib/widgets/load.tsx and read by each widget's renderer
// (components/widgets/registry.tsx), in place of a prop per widget. Widget
// content is per instance since 3.0 (#297), keyed by instance id.
import type { ReactNode } from "react";
import type { AppItem, BookmarkItem, WidgetInstance } from "../schema";
import type { SearchConfig } from "../search";
import type { CurrentWeather } from "../weather";
import type { SystemStats } from "../system-stats";

export type HomeData = {
  apps: AppItem[];
  bookmarks: BookmarkItem[];
  search: SearchConfig;
  categoryOrder: string[];
  // When on, the Apps widget splits private apps into their own labeled
  // "Private Applications" group. Only affects the admin — guests never
  // receive private apps, so the group is always empty for them.
  groupPrivateApps: boolean;
  // Server-computed seeds for the header widgets (admin default tz /
  // location), updated client-side to the visitor's effective prefs after
  // mount.
  initialDate: string;
  initialGreeting: string;
  initialWeather: CurrentWeather | null;
  // The server's request instant (ISO), seeding the World Clocks widget so its
  // clocks render with the right time before the client tick takes over.
  initialNow: string;
  weatherEnabled: boolean;
  statusEnabled: boolean;
  // Every widget instance by id, as safe to send to the browser (secrets
  // redacted): each renderer reads its own content here.
  instances: Record<string, WidgetInstance>;
  // What the editor calls each instance (lib/widgets/labels.ts).
  labels: Record<string, string>;
  // Widgets rendered server-side (calendar, feed), by instance id. A missing
  // entry means off or empty, and its layout cell renders nothing.
  nodes: Record<string, ReactNode>;
  // System Stats snapshots by instance id; null when collection was skipped
  // (hidden for a guest) or failed.
  systemStats: Record<string, SystemStats | null>;
};
