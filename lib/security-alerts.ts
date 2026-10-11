import { sendNotification } from "./alerts";
import { readConfigInternal } from "./config";
import { log, errorReason } from "./log";
import type { SecurityEvent } from "./security-events";
import type { WebhookNotification } from "./webhooks";

// Security notifications (#368): the audit-log entries an admin would want
// to hear about at once, sent through the alert channels that take them
// (each channel's "Security" switch). A sign-in from a new address, the
// login throttle tripping, the second factor turned off, the password
// changed, dashboard actions turned on — the signs of a session or password
// in the wrong hands, or of the account being reshaped.

const where = (e: SecurityEvent) => (e.ip ? `from ${e.ip}` : "from an unknown address");

// The message for an event, or null for the ones that don't warrant one.
export function securityNotification(e: SecurityEvent): WebhookNotification | null {
  switch (e.kind) {
    case "signin.ok":
      if (!e.newAddress) return null;
      return {
        title: "Admin sign-in from a new address",
        body: `Someone signed in to the admin portal ${where(e)} with ${e.userAgent || "an unknown browser"}. If that wasn't you, sign out everywhere else in Settings → Security and change the password.`,
      };
    case "signin.locked":
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
  if (!content) return;
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
