import { sendNotification } from "./alerts";
import { readConfigInternal } from "./config";
import { log, errorReason } from "./log";
import type { SecurityEvent } from "./security-events";
import { globalSingleton } from "./singleton";
import type { WebhookNotification } from "./webhooks";

// Security notifications (#368): the audit-log entries an admin would want
// to hear about at once, sent through the alert channels that take them
// (each channel's "Security" switch). A sign-in from a new address, the
// login throttle tripping, the second factor turned off, the password
// changed, dashboard actions turned on — the signs of a session or password
// in the wrong hands, or of the account being reshaped.

const where = (e: SecurityEvent) => (e.ip ? `from ${e.ip}` : "from an unknown address");

// The detail a `signin.locked` entry carries when it was the shared
// wrong-code budget that ran out, not one address's password attempts.
export const CODES_LOCKED = "authentication codes";

// At most one notification of each kind every ten minutes (#392). The lockout
// notice can be provoked from any address without knowing the password, so a
// run through many addresses would otherwise flood the channels; the audit
// log still has every entry. A sign-in from a new address is exempt: each is
// a distinct fact worth hearing about, and it takes the password to cause one.
const NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;
const lastNotified = globalSingleton(
  "__ctrlcenterSecurityNotified",
  () => new Map<string, number>()
);
export function notificationDue(e: SecurityEvent, now = Date.now()): boolean {
  if (e.kind === "signin.ok") return true;
  const key = `${e.kind}:${e.detail ?? ""}`;
  const last = lastNotified.get(key);
  if (last !== undefined && now - last < NOTIFY_COOLDOWN_MS) return false;
  lastNotified.set(key, now);
  return true;
}

// The message for an event, or null for the ones that don't warrant one.
export function securityNotification(e: SecurityEvent): WebhookNotification | null {
  switch (e.kind) {
    case "signin.ok":
      if (!e.newAddress) return null;
      return {
        title: "Admin sign-in from a new address",
        body: `Someone signed in to the admin portal ${where(e)} with ${e.userAgent || "an unknown browser"}. If that wasn't you, sign out everywhere else in Settings → Security and change the password.`,
      };
    case "session.moved":
      return {
        title: "Admin session used from a new address",
        body: `A session that ${e.detail ?? "signed in elsewhere"} was just used ${where(e)} with ${e.userAgent || "an unknown browser"}. If that wasn't you, sign out everywhere else in Settings → Security and change the password.`,
      };
    case "signin.locked":
      if (e.detail === CODES_LOCKED) {
        return {
          title: "Two-factor codes paused after repeated failures",
          body: `Too many wrong authentication codes were tried, most recently ${where(e)}. Whoever is trying has the password: code sign-in is paused for a while, and nothing got in. Change the password in Settings → Security.`,
        };
      }
      return {
        title: "Admin login locked after repeated failures",
        body: `Too many wrong passwords ${where(e)}; that address is locked out for a while. Nothing got in.`,
      };
    case "totp.disabled":
      return {
        title: "Two-factor authentication turned off",
        body: `The admin's second factor was turned off ${where(e)}. Dashboard actions were turned off with it.`,
      };
    case "password.changed":
      return {
        title: "Admin password changed",
        body: `The admin password was changed ${where(e)}. Every other session was signed out.`,
      };
    case "actions.enabled":
      return {
        title: "Dashboard actions turned on",
        body: `Actions from the dashboard were turned on for ${e.detail ?? "an integration"} ${where(e)}.`,
      };
    default:
      return null;
  }
}

// Send the event's notification, if it has one, to the channels that take
// security events. Best-effort and detached: a slow channel must never hold
// up a sign-in.
export function notifySecurityEvent(e: SecurityEvent): void {
  const content = securityNotification(e);
  if (!content || !notificationDue(e)) return;
  void (async () => {
    try {
      const { settings } = await readConfigInternal();
      await sendNotification(
        settings.alerts,
        content,
        { at: e.at, timeZone: settings.timezone, siteTitle: settings.title },
        (ch) => ch.onSecurity
      );
    } catch (err) {
      log.warn("security notification failed", { reason: errorReason(err) });
    }
  })();
}
