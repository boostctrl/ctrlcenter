// The first-run setup (#304): shown to the admin on a fresh install — nothing
// added yet and the setup never finished or skipped. Once either happens
// (settings.setupComplete), it never shows again; config.yaml can always be
// edited directly instead.
import type { Config } from "./schema";

export function needsSetup(config: Pick<Config, "settings" | "apps" | "bookmarks">): boolean {
  return !config.settings.setupComplete && config.apps.length === 0 && config.bookmarks.length === 0;
}

// Name an app from its address: the host's first label, capitalized
// ("http://jellyfin.lan:8096" → "Jellyfin"); an IP address stays whole.
export function appNameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
    const first = host.split(".")[0] || host;
    return first.charAt(0).toUpperCase() + first.slice(1);
  } catch {
    return url;
  }
}

// The URLs in pasted text: one per line (or comma-separated), http(s) only,
// duplicates dropped. A bare host is given http:// when it looks like one (a
// dot, a port, or localhost); anything else is skipped.
export function parsePastedUrls(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const t = raw.trim();
    if (!t || /\s/.test(t)) continue;
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t);
    try {
      const u = new URL(hasScheme ? t : `http://${t}`);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (!hasScheme && !/[.:]/.test(u.host) && u.hostname !== "localhost") continue;
      const href = u.href.replace(/\/$/, "");
      if (!out.includes(href)) out.push(href);
    } catch {
      // Not a URL; skipped.
    }
  }
  return out;
}
