// Per-visitor preferences, stored in localStorage. These override the admin
// defaults (timezone, weather location/units) for a single visitor's browser
// only — nothing is written to the server, so any visitor can correct their own
// view without auth and without affecting anyone else.
export type Units = "imperial" | "metric";

export type VisitorLocation = {
  latitude: number;
  longitude: number;
  label?: string;
  source: "ip" | "device" | "manual";
};

export type VisitorPrefs = {
  timezone?: string;
  units?: Units;
  location?: VisitorLocation;
  // Set once the visitor explicitly reset to defaults, so we don't re-run the
  // automatic IP detection on subsequent loads.
  dismissedAuto?: boolean;
};

export const PREFS_KEY = "homepage:prefs";

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// Defensively validate whatever is in localStorage; corrupt or tampered data
// must never break the page or smuggle bad values into the weather request.
export function sanitizePrefs(input: unknown): VisitorPrefs {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const prefs: VisitorPrefs = {};

  if (typeof raw.timezone === "string" && raw.timezone.length <= 100) {
    prefs.timezone = raw.timezone;
  }
  if (raw.units === "imperial" || raw.units === "metric") {
    prefs.units = raw.units;
  }
  if (raw.dismissedAuto === true) {
    prefs.dismissedAuto = true;
  }

  const loc = raw.location as Record<string, unknown> | undefined;
  if (
    loc &&
    isFiniteNumber(loc.latitude) &&
    isFiniteNumber(loc.longitude) &&
    loc.latitude >= -90 &&
    loc.latitude <= 90 &&
    loc.longitude >= -180 &&
    loc.longitude <= 180
  ) {
    const source =
      loc.source === "ip" || loc.source === "device" || loc.source === "manual"
        ? loc.source
        : "manual";
    prefs.location = {
      latitude: loc.latitude,
      longitude: loc.longitude,
      source,
      ...(typeof loc.label === "string" && loc.label
        ? { label: loc.label.slice(0, 80) }
        : {}),
    };
  }

  return prefs;
}

export function loadPrefs(): VisitorPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? sanitizePrefs(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs: VisitorPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode / quota — preferences just won't persist.
  }
}

export function detectTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// All IANA zones, for the editor's timezone picker (falls back to empty if the
// runtime doesn't support it).
export function supportedTimezones(): string[] {
  try {
    const fn = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf;
    return fn ? fn("timeZone") : [];
  } catch {
    return [];
  }
}
