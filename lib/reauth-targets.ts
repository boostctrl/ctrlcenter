import type { AlertChannel, InstanceOf, WidgetInstance } from "./schema";

// Which saves change where a secret is sent, and so need a recent
// confirmation (#378) — the same rule /api/integrations applies to an
// integration's address and credentials (#366). A secret held in the
// environment is resolved on the server at use time and sent to the host the
// config names, so a session that could re-point that host without the
// password could collect the secret there. Edits that don't move a secret —
// titles, display options, refresh, a feed's URL — pass on the session alone,
// so autosave only asks when it matters.

// An API widget's request (#302): its URL and header values may hold `${ENV}`
// references, and its body goes wherever the URL says.
function apiRequest(w: Pick<InstanceOf<"api">, "url" | "method" | "headers" | "body">): string {
  return JSON.stringify([w.url, w.method, w.headers.map((h) => [h.name, h.value]), w.body]);
}

// A calendar's address and sign-in: Basic auth (and, for the migrated 2.x
// calendar, CTRLCENTER_CALDAV_PASS) goes to that address.
function calendarTarget(w: Pick<InstanceOf<"calendar">, "url" | "username" | "password">): string {
  return JSON.stringify([w.url, w.username, w.password]);
}

const EMPTY_API = apiRequest({ url: "", method: "GET", headers: [], body: "" });
const EMPTY_CALENDAR = calendarTarget({ url: "", username: "", password: "" });

function widgetTarget(w: WidgetInstance): { kind: string; target: string; empty: string } | null {
  if (w.type === "api") return { kind: "api", target: apiRequest(w), empty: EMPTY_API };
  if (w.type === "calendar") return { kind: "calendar", target: calendarTarget(w), empty: EMPTY_CALENDAR };
  return null;
}

// Whether saving `next` over `stored` changes an API widget's request or a
// calendar's address or sign-in. A new widget counts once it has any of
// those set (the palette's fresh, empty one doesn't); removing one never
// does.
export function widgetsChangeTarget(next: WidgetInstance[], stored: WidgetInstance[]): boolean {
  return next.some((w) => {
    const now = widgetTarget(w);
    if (!now) return false;
    const was = stored.find((o) => o.id === w.id);
    const before = was ? widgetTarget(was) : null;
    if (!before || before.kind !== now.kind) return now.target !== now.empty;
    return now.target !== before.target;
  });
}

// Whether a channel list re-points an email channel's SMTP server: the
// password (CTRLCENTER_SMTP_PASS, when set, beats the stored one) is sent to
// that host to sign in. A new email channel counts once it names a host, as
// does a channel switched to email.
type ChannelTarget = Pick<AlertChannel, "id" | "type"> & { smtp?: { host?: string } };
export function alertChannelsChangeTarget(next: ChannelTarget[], stored: ChannelTarget[]): boolean {
  return next.some((c) => {
    const host = c.type === "email" ? (c.smtp?.host ?? "").trim() : "";
    if (!host) return false;
    const was = stored.find((o) => o.id === c.id);
    if (!was || was.type !== "email") return true;
    return host !== (was.smtp?.host ?? "").trim();
  });
}

// Whether a channel list silences the Security notifications (#382): a
// stored channel that carried them, enabled, is gone, switched off, or has
// its Security switch turned off. A stolen session could otherwise quiet the
// one thing that would announce it.
type ChannelSecurity = Pick<AlertChannel, "id" | "enabled" | "onSecurity">;
export function alertChannelsDropSecurity(next: ChannelSecurity[], stored: ChannelSecurity[]): boolean {
  return stored.some((was) => {
    if (!was.enabled || !was.onSecurity) return false;
    const now = next.find((c) => c.id === was.id);
    return !now || !now.enabled || !now.onSecurity;
  });
}
