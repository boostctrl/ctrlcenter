import { supportedTimezones } from "@/lib/prefs";

// Time-zone suggestions are browser data: Node's ICU zone list can differ
// from the browser's (417 vs 418 entries in practice), so server-rendering
// the datalist makes hydration flag a mismatch on every load. Serve an empty
// list and fill in the browser's own after mount (useSyncExternalStore's
// server/client snapshot split) — the suggestions are pure progressive
// enhancement. The snapshots are cached: getSnapshot must be referentially
// stable or the store re-syncs forever.
export const NO_ZONES: string[] = [];
let zonesCache: string[] | null = null;
export const getBrowserZones = () => (zonesCache ??= supportedTimezones());
export const subscribeZonesNever = () => () => {};
