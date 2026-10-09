// What the home page hands the widgets (#285): one object, built on the
// server by lib/widgets/load.tsx and read by each widget's renderer
// (components/widgets/registry.tsx), in place of a prop per widget.
import type { ReactNode } from "react";
import type {
  AppItem,
  BookmarkItem,
  CountdownConfig,
  NotesConfig,
  WorldClocksConfig,
} from "../schema";
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
  showClock: boolean;
  statusEnabled: boolean;
  // The Notes widget's admin-authored title + markdown body.
  notes: NotesConfig;
  // The Countdown widget's admin-authored title + dated rows.
  countdown: CountdownConfig;
  // The World Clocks widget's admin-authored title + labeled time zones.
  worldClocks: WorldClocksConfig;
  // The System Stats widget's title + the server-collected snapshot; null when
  // collection was skipped (widget hidden for a guest) or failed.
  systemStats: { title: string; stats: SystemStats | null };
  // The calendar widget, rendered server-side; null when it wouldn't render,
  // so its layout cell isn't left empty.
  calendar: ReactNode;
  // The rendered RSS feed cards, keyed by feed instance id (rendered
  // server-side, like `calendar`). A card missing from the map is off/empty
  // and its layout cell renders nothing.
  feedNodes: Record<string, ReactNode>;
  // Per-instance display label for the editor's frame/tray (the card's title,
  // else a generic), so multiple feed cards stay distinguishable.
  feedLabels: Record<string, string>;
};
