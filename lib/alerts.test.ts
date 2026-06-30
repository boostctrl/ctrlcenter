import { describe, it, expect } from "vitest";
import {
  evaluateTransitions,
  buildAlertRequest,
  buildEmailMessage,
  renderSubject,
  emailReady,
  type AppAlertState,
  type AlertEvent,
} from "./alerts";
import { alertEmailSchema } from "./schema";

const opts = (confirmations = 1, notifyOnRecovery = true) => ({
  confirmations,
  notifyOnRecovery,
});

describe("evaluateTransitions", () => {
  it("does not fire while an app stays up", () => {
    const { events, next } = evaluateTransitions(
      new Map(),
      [{ id: "a", up: true }],
      opts()
    );
    expect(events).toEqual([]);
    expect(next.get("a")).toEqual({ confirmed: "up", downStreak: 0 });
  });

  it("fires a down alert once a confirmed-up app goes down", () => {
    const state = new Map<string, AppAlertState>([
      ["a", { confirmed: "up", downStreak: 0 }],
    ]);
    const first = evaluateTransitions(state, [{ id: "a", up: false }], opts());
    expect(first.events).toEqual([{ id: "a", type: "down" }]);
    // Staying down doesn't re-alert.
    const second = evaluateTransitions(first.next, [{ id: "a", up: false }], opts());
    expect(second.events).toEqual([]);
  });

  it("requires `confirmations` consecutive failures before alerting", () => {
    const state = new Map<string, AppAlertState>([
      ["a", { confirmed: "up", downStreak: 0 }],
    ]);
    const first = evaluateTransitions(state, [{ id: "a", up: false }], opts(2));
    expect(first.events).toEqual([]); // one failure, threshold 2
    expect(first.next.get("a")).toEqual({ confirmed: "up", downStreak: 1 });
    const second = evaluateTransitions(first.next, [{ id: "a", up: false }], opts(2));
    expect(second.events).toEqual([{ id: "a", type: "down" }]);
  });

  it("a single up resets the streak so flaps don't trip the threshold", () => {
    const state = new Map<string, AppAlertState>([
      ["a", { confirmed: "up", downStreak: 0 }],
    ]);
    const a = evaluateTransitions(state, [{ id: "a", up: false }], opts(2));
    const b = evaluateTransitions(a.next, [{ id: "a", up: true }], opts(2));
    const c = evaluateTransitions(b.next, [{ id: "a", up: false }], opts(2));
    expect(a.events).toEqual([]);
    expect(b.events).toEqual([]); // recovery only fires from a *confirmed* down
    expect(c.events).toEqual([]); // streak was reset, so still below threshold
  });

  it("fires a recovery when a confirmed-down app comes back up", () => {
    const state = new Map<string, AppAlertState>([
      ["a", { confirmed: "down", downStreak: 3 }],
    ]);
    const { events, next } = evaluateTransitions(
      state,
      [{ id: "a", up: true }],
      opts()
    );
    expect(events).toEqual([{ id: "a", type: "up" }]);
    expect(next.get("a")).toEqual({ confirmed: "up", downStreak: 0 });
  });

  it("suppresses recovery alerts when notifyOnRecovery is off, but clears the down state", () => {
    const state = new Map<string, AppAlertState>([
      ["a", { confirmed: "down", downStreak: 3 }],
    ]);
    const up = evaluateTransitions(state, [{ id: "a", up: true }], opts(1, false));
    expect(up.events).toEqual([]);
    expect(up.next.get("a")).toEqual({ confirmed: "up", downStreak: 0 });
    // A later down still alerts because the state was cleared to up.
    const down = evaluateTransitions(up.next, [{ id: "a", up: false }], opts(1, false));
    expect(down.events).toEqual([{ id: "a", type: "down" }]);
  });

  it("does not re-alert an app seeded as already-down", () => {
    const seeded = new Map<string, AppAlertState>([
      ["a", { confirmed: "down", downStreak: 0 }],
    ]);
    const { events } = evaluateTransitions(seeded, [{ id: "a", up: false }], opts());
    expect(events).toEqual([]);
  });
});

describe("buildAlertRequest", () => {
  const app = { name: "Jellyfin", url: "https://jelly.example.com" };
  const down: AlertEvent = { id: "a", type: "down" };
  const up: AlertEvent = { id: "a", type: "up" };
  const at = Date.parse("2026-06-30T12:00:00Z");

  it("generic posts a JSON envelope with the status and service", () => {
    const req = buildAlertRequest("generic", "https://hook", down, app, at);
    expect(req.url).toBe("https://hook");
    expect(req.init.method).toBe("POST");
    const body = JSON.parse(req.init.body as string);
    expect(body).toMatchObject({
      service: "Jellyfin",
      url: app.url,
      status: "down",
      at: "2026-06-30T12:00:00.000Z",
    });
    expect(body.message).toContain("Jellyfin is down");
  });

  it("discord uses a content field", () => {
    const req = buildAlertRequest("discord", "https://discord", down, app, at);
    const body = JSON.parse(req.init.body as string);
    expect(body.content).toContain("Jellyfin is down");
    expect(body.content).toContain(app.url);
  });

  it("slack uses a text field", () => {
    const req = buildAlertRequest("slack", "https://slack", up, app, at);
    const body = JSON.parse(req.init.body as string);
    expect(body.text).toContain("Jellyfin recovered");
  });

  it("ntfy posts the message in the body with title/priority headers", () => {
    const req = buildAlertRequest("ntfy", "https://ntfy.sh/topic", down, app, at);
    const headers = req.init.headers as Record<string, string>;
    expect(headers.Title).toBe("Jellyfin is down");
    expect(headers.Priority).toBe("high");
    expect(req.init.body).toContain("Jellyfin is down");
    expect(req.init.body).toContain(app.url);
  });

  it("ntfy drops a non-ASCII Title (latin-1 header) but keeps it in the body", () => {
    const unicode = { name: "Café 日本", url: "https://x.example" };
    const req = buildAlertRequest("ntfy", "https://ntfy.sh/topic", down, unicode, at);
    const headers = req.init.headers as Record<string, string>;
    expect(headers.Title).toBeUndefined();
    expect(headers.Priority).toBe("high");
    expect(req.init.body).toContain("Café 日本 is down");
  });
});

describe("buildEmailMessage", () => {
  const app = { name: "Jellyfin", url: "https://jelly.example.com" };
  const at = Date.parse("2026-06-30T12:00:00Z");

  it("defaults the subject and includes the URL/timestamp in text and HTML", () => {
    const { subject, text, html } = buildEmailMessage(
      { id: "a", type: "down" },
      app,
      at
    );
    expect(subject).toBe("Jellyfin is down"); // default template
    expect(text).toContain("🔴 Jellyfin is down");
    expect(text).toContain(app.url);
    expect(text).toContain("2026-06-30T12:00:00.000Z");
    expect(html).toContain("Jellyfin is down");
    expect(html).toContain(app.url);
    expect(html).toContain("<html");
  });

  it("omits the URL line/row when there's no URL and renders the up status", () => {
    const { subject, text, html } = buildEmailMessage(
      { id: "a", type: "up" },
      { name: "DB", url: "" },
      at
    );
    expect(subject).toBe("DB is up"); // default template, {status} = up
    expect(text).toContain("🟢 DB recovered");
    expect(text).not.toContain("\nhttp");
    expect(html).not.toContain("href");
  });

  it("renders a custom subject template and HTML-escapes the service name", () => {
    const evil = { name: 'A&B <x> "q"', url: "https://x" };
    const { subject, html } = buildEmailMessage(
      { id: "a", type: "down" },
      evil,
      at,
      "[ALERT] {service} ({status})"
    );
    expect(subject).toBe('[ALERT] A&B <x> "q" (down)'); // subject is plain text
    expect(html).toContain("A&amp;B &lt;x&gt; &quot;q&quot;"); // escaped in HTML
    expect(html).not.toContain("<x>");
  });
});

describe("renderSubject", () => {
  it("substitutes variables and strips CR/LF (header-injection guard)", () => {
    const out = renderSubject(
      "{service} is {status}\r\nBcc: evil@x",
      { name: "API", url: "" },
      true
    );
    expect(out).toBe("API is down Bcc: evil@x"); // newlines collapsed to a space
    expect(out).not.toMatch(/[\r\n]/);
  });

  it("falls back to the default when the template is blank", () => {
    expect(renderSubject("   ", { name: "API", url: "" }, false)).toBe("API is up");
  });
});

describe("emailReady", () => {
  const base = alertEmailSchema.parse({});

  it("is false unless enabled with host, from, and to", () => {
    expect(emailReady(base)).toBe(false);
    expect(emailReady({ ...base, enabled: true })).toBe(false);
    expect(
      emailReady({ ...base, enabled: true, host: "smtp", from: "a@x" })
    ).toBe(false);
    expect(
      emailReady({ ...base, enabled: true, host: "smtp", from: "a@x", to: "b@y" })
    ).toBe(true);
  });

  it("is false when enabled is off even with full config", () => {
    expect(
      emailReady({ ...base, host: "smtp", from: "a@x", to: "b@y" })
    ).toBe(false);
  });
});
