// What a visitor's board carries of each widget instance (#380). The board's
// widget data is a client component's prop (components/Dashboard.tsx), so all
// of it is serialized into the page, and a stored instance holds what only
// the server should read: a calendar's address (a "secret address" is a
// password in a URL), feed URLs (often tokenized), disk mount paths (#184),
// an API widget's request (#302). So a visitor gets each instance cut down to
// the fields its renderer reads (components/widgets/registry.tsx, and the
// apps/bookmarks filters Dashboard's search applies). Whatever is fetched at
// request time renders on the server from the instance as stored
// (lib/widgets/load.tsx), so nothing it needs is lost.
//
// An allowlist, typed over every type: a new type has to say what it shows,
// and a field added to a type stays off the page until it's listed here. The
// renderers read this public shape, so one can't start reading a field the
// table doesn't send. Keys are top-level: a listed object or list goes whole,
// so list one only when the renderer reads all of it. Pure; importable from
// client code.
import type { InstanceOf, WidgetInstance, WidgetInstanceType } from "../schema";

type ContentKey<T extends WidgetInstanceType> = Exclude<keyof InstanceOf<T>, "id" | "type">;

export const PUBLIC_FIELDS = {
  greeting: [],
  headerCard: ["showClock"],
  clock: [],
  weather: [],
  status: [],
  search: [],
  // Rendered on the server (data.nodes); the address and credentials stay there.
  calendar: [],
  notes: ["title", "content"],
  // Rendered on the server (data.nodes); the URLs stay there.
  feed: [],
  countdown: ["title", "items"],
  worldClocks: ["title", "items"],
  // The numbers come from data.systemStats, each disk by its label only.
  systemStats: ["title"],
  // The tile comes from data.integrationTiles.
  integration: [],
  // The values come from data.apiViews; the request stays on the server.
  api: ["title"],
  favorites: [],
  apps: ["title", "filter"],
  bookmarks: ["title", "filter"],
} as const satisfies { [T in WidgetInstanceType]: readonly ContentKey<T>[] };

type Listed<T extends WidgetInstanceType> = (typeof PUBLIC_FIELDS)[T][number];
type PublicShape<T extends WidgetInstanceType> = Pick<
  InstanceOf<T>,
  Extract<"id" | "type" | Listed<T>, keyof InstanceOf<T>>
>;

// An instance as a visitor's page carries it, and one type's.
export type PublicInstance = { [T in WidgetInstanceType]: PublicShape<T> }[WidgetInstanceType];
export type PublicInstanceOf<T extends WidgetInstanceType> = Extract<PublicInstance, { type: T }>;

// `w` as a visitor's page carries it: its id, its type and the listed fields.
export function publicInstance(w: WidgetInstance): PublicInstance {
  const keep = new Set<string>(["id", "type", ...PUBLIC_FIELDS[w.type]]);
  return Object.fromEntries(Object.entries(w).filter(([k]) => keep.has(k))) as PublicInstance;
}
