import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  evaluateTransitions,
  buildAlertRequest,
  buildEmailMessage,
  renderSubject,
  sendTestAlert,
  sendSampleNotification,
  buildServiceRequest,
  plainAlert,
  plainNotification,
  processAlerts,
  sendNotification,
  evaluateWarnings,
  describeAlert,
  anyChannelReady,
  type AppAlertState,
  type AlertEvent,
} from "./alerts";
import { alertChannelSchema, alertsSchema, settingsSchema } from "./schema";
import { parseArrWebhook } from "./webhooks";

// Stub nodemailer's transport so the email path is exercised without SMTP.
// sendMail is reconfigured per test (resolve = delivered, reject = failure).
const { sendMailMock } = vi.hoisted(() => ({ sendMailMock: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

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

describe("evaluateWarnings", () => {
  const warn = (id: string, warning?: string, up = true) => ({ id, up, warning });

  it("alerts when an up app starts warning, then stays quiet", () => {
    const first = evaluateWarnings(new Map(), [warn("a", "Certificate expires in 6 days")], 0);
    expect(first.events).toEqual([{ id: "a", type: "warning", detail: "Certificate expires in 6 days" }]);
    const again = evaluateWarnings(first.next, [warn("a", "Certificate expires in 6 days")], 60_000);
    expect(again.events).toEqual([]);
  });

  it("reminds once the reminder interval has passed", () => {
    const { next } = evaluateWarnings(new Map(), [warn("a", "x")], 0, 1000);
    expect(evaluateWarnings(next, [warn("a", "y")], 999, 1000).events).toEqual([]);
    expect(evaluateWarnings(next, [warn("a", "y")], 1000, 1000).events).toEqual([
      { id: "a", type: "warning", detail: "y" },
    ]);
  });

  it("notes when the warning clears", () => {
    const { next } = evaluateWarnings(new Map(), [warn("a", "x")], 0);
    const after = evaluateWarnings(next, [warn("a")], 1);
    expect(after.events).toEqual([{ id: "a", type: "cleared" }]);
    expect(after.next.size).toBe(0);
  });

  it("doesn't re-announce a warning after a failed check", () => {
    const { next } = evaluateWarnings(new Map(), [warn("a", "x")], 0);
    const blip = evaluateWarnings(next, [warn("a", undefined, false)], 1);
    expect(blip.events).toEqual([]);
    expect(evaluateWarnings(blip.next, [warn("a", "x")], 2).events).toEqual([]);
  });

  it("sends no cleared note when the app comes back from a failure without its warning", () => {
    const { next } = evaluateWarnings(new Map(), [warn("a", "x")], 0);
    const down = evaluateWarnings(next, [warn("a", undefined, false)], 1);
    const back = evaluateWarnings(down.next, [warn("a")], 2);
    expect(back.events).toEqual([]);
    expect(back.next.size).toBe(0);
  });

  it("ignores apps that never warned", () => {
    expect(evaluateWarnings(new Map(), [warn("a"), warn("b", undefined, false)], 0).events).toEqual([]);
  });
});

describe("describeAlert", () => {
  const app = { name: "Plex", url: "" };
  it("words each event", () => {
    expect(describeAlert({ id: "a", type: "down" }, app).title).toBe("Plex is down");
    expect(describeAlert({ id: "a", type: "up" }, app).title).toBe("Plex recovered");
    expect(describeAlert({ id: "a", type: "warning", detail: "Certificate expires in 3 days" }, app)).toMatchObject({
      title: "Plex: Certificate expires in 3 days",
      emoji: "🟠",
      status: "warning",
    });
    expect(describeAlert({ id: "a", type: "cleared" }, app).title).toBe("Plex: warning cleared");
  });

  it("carries a warning into each format", () => {
    const e = { id: "a", type: "warning" as const, detail: "Certificate expires in 3 days" };
    const ntfy = buildAlertRequest("ntfy", "https://n.test", e, app, 0);
    expect((ntfy.init.headers as Record<string, string>).Tags).toBe("warning");
    const generic = JSON.parse(buildAlertRequest("generic", "https://g.test", e, app, 0).init.body as string);
    expect(generic).toMatchObject({ status: "warning", detail: "Certificate expires in 3 days" });
    expect(buildEmailMessage(e, app, 0).subject).toBe("Plex: Certificate expires in 3 days");
    expect(buildEmailMessage(e, app, 0, "{service} is {status}").subject).toBe("Plex is warning");
    const apprise = buildServiceRequest(
      { type: "apprise", url: "http://a.test", token: "", chatId: "", userKey: "" },
      plainAlert(e, app)
    );
    expect(JSON.parse(apprise.init.body as string).type).toBe("warning");
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
      "down"
    );
    expect(out).toBe("API is down Bcc: evil@x"); // newlines collapsed to a space
    expect(out).not.toMatch(/[\r\n]/);
  });

  it("falls back to the default when the template is blank", () => {
    expect(renderSubject("   ", { name: "API", url: "" }, "up")).toBe("API is up");
  });
});

describe("buildServiceRequest", () => {
  const ch = {
    type: "telegram" as const,
    url: "",
    token: " 123:abc ",
    chatId: "-100",
    userKey: "",
  };
  const down = plainAlert({ id: "a", type: "down" }, { name: "Plex", url: "https://plex.test" });

  it("telegram posts plain text with the link to the bot's sendMessage", () => {
    const req = buildServiceRequest(ch, down);
    expect(req.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(req.init.body as string)).toEqual({
      chat_id: "-100",
      text: "🔴 Plex is down\nhttps://plex.test",
      disable_web_page_preview: true,
    });
  });

  it("gotify posts to /message with the app token header and a high priority for down", () => {
    const req = buildServiceRequest({ ...ch, type: "gotify", url: "https://gotify.test/", token: "tok" }, down);
    expect(req.url).toBe("https://gotify.test/message");
    expect((req.init.headers as Record<string, string>)["X-Gotify-Key"]).toBe("tok");
    expect(JSON.parse(req.init.body as string)).toEqual({
      title: "Plex is down",
      message: "🔴 Plex is down\nhttps://plex.test",
      priority: 8,
    });
  });

  it("pushover posts a form with token, user, link and priority", () => {
    const up = plainAlert({ id: "a", type: "up" }, { name: "Plex", url: "https://plex.test" });
    const req = buildServiceRequest({ ...ch, type: "pushover", token: "app", userKey: "usr" }, up);
    expect(req.url).toBe("https://api.pushover.net/1/messages.json");
    const form = new URLSearchParams(req.init.body as string);
    expect(Object.fromEntries(form)).toEqual({
      token: "app",
      user: "usr",
      title: "Plex recovered",
      message: "🟢 Plex recovered",
      priority: "0",
      url: "https://plex.test",
    });
  });

  it("apprise posts title, body and a notification type", () => {
    const req = buildServiceRequest({ ...ch, type: "apprise", url: "http://apprise:8000/notify/cc" }, down);
    expect(req.url).toBe("http://apprise:8000/notify/cc");
    expect(JSON.parse(req.init.body as string)).toMatchObject({ title: "Plex is down", type: "failure" });
  });

  it("puts a notification's title in the text for services without a title field", () => {
    const m = plainNotification({ title: "Sonarr: grabbed", body: "Show S01E02", url: "" });
    expect(m).toMatchObject({ title: "Sonarr: grabbed", body: "Show S01E02", text: "Sonarr: grabbed\nShow S01E02" });
    const req = buildServiceRequest(ch, m);
    expect(JSON.parse(req.init.body as string).text).toBe("Sonarr: grabbed\nShow S01E02");
  });
});

const channel = (over: Record<string, unknown>) =>
  alertChannelSchema.parse({ id: "c1", type: "webhook", url: "https://hook.example.com/x", ...over });

describe("sendTestAlert", () => {
  const webhookOnly = alertsSchema.parse({ channels: [channel({ id: "hook" })] });

  afterEach(() => {
    vi.unstubAllGlobals();
    sendMailMock.mockReset();
  });

  it("reports webhook success and posts the synthetic down event to the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendTestAlert(webhookOnly);
    expect(result).toEqual({
      results: [{ id: "hook", label: "Webhook", ok: true, detail: "HTTP 204" }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hook.example.com/x");
    const body = JSON.parse(init.body as string);
    expect(body.status).toBe("down");
    expect(body.message).toContain("CtrlCenter test alert is down");
  });

  it("reports a rejection as ok:false with the HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const { results } = await sendTestAlert(webhookOnly);
    expect(results[0]).toMatchObject({ ok: false, detail: "HTTP 404" });
  });

  it("reports a network failure as ok:false with the reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    const { results } = await sendTestAlert(webhookOnly);
    expect(results[0]).toMatchObject({ ok: false, detail: "connect ECONNREFUSED" });
  });

  it("attempts nothing when no channel is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendTestAlert(alertsSchema.parse({}))).toEqual({ results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("tests every active channel, ignoring the master switch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    sendMailMock.mockResolvedValue({});
    const config = alertsSchema.parse({
      enabled: false,
      channels: [
        channel({ id: "hook" }),
        channel({ id: "mail", type: "email", smtp: { host: "smtp.example.com", from: "a@x", to: "b@y" } }),
        channel({ id: "tg", type: "telegram", token: "t", chatId: "1" }),
        channel({ id: "off", enabled: false }),
      ],
    });
    const { results } = await sendTestAlert(config);
    expect(results.map((r) => [r.id, r.ok, r.detail])).toEqual([
      ["hook", true, "HTTP 200"],
      ["mail", true, "sent"],
      ["tg", true, "HTTP 200"],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("tests one channel by id, even while it's switched off", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const config = alertsSchema.parse({
      channels: [channel({ id: "a" }), channel({ id: "b", enabled: false, name: "Mine", url: "https://b.test" })],
    });
    expect(await sendTestAlert(config, "b")).toEqual({
      results: [{ id: "b", label: "Mine", ok: true, detail: "HTTP 200" }],
    });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://b.test"]);
  });

  it("skips a channel that is missing a required field", async () => {
    const config = alertsSchema.parse({ channels: [channel({ id: "a", url: "" })] });
    expect(await sendTestAlert(config, "a")).toEqual({ results: [] });
  });

  it("reports an email send failure as ok:false with the reason", async () => {
    sendMailMock.mockRejectedValue(new Error("SMTP auth failed"));
    const config = alertsSchema.parse({
      channels: [channel({ type: "email", smtp: { host: "smtp.example.com", from: "a@x", to: "b@y" } })],
    });
    const { results } = await sendTestAlert(config);
    expect(results).toEqual([
      { id: "c1", label: "Email (SMTP)", ok: false, detail: "SMTP auth failed" },
    ]);
  });
});

describe("sendSampleNotification", () => {
  // Settings as the route reads them: the channels, the saved report options
  // and the site's footer line.
  const settings = (over: { alerts?: unknown; webhooks?: unknown } = {}) =>
    settingsSchema.parse({ title: "Lab", timezone: "UTC", ...over });
  const smtp = { host: "smtp.example.com", from: "a@x", to: "b@y" };

  afterEach(() => {
    vi.unstubAllGlobals();
    sendMailMock.mockReset();
  });

  it("relays the sample to the active channels that take inbound webhooks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const config = settings({
      alerts: {
        enabled: false,
        channels: [
          channel({ id: "hook" }),
          channel({ id: "no", url: "https://no.test", onWebhooks: false }),
          channel({ id: "off", url: "https://off.test", enabled: false }),
          channel({ id: "tg", type: "telegram", token: "t", chatId: "1" }),
        ],
      },
    });
    const { results } = await sendSampleNotification(config, "sonarr-import");
    expect(results.map((r) => [r.id, r.ok, r.detail])).toEqual([
      ["hook", true, "HTTP 204"],
      ["tg", true, "HTTP 204"],
    ]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://hook.example.com/x");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // The default burst window is on, so the season goes merged.
    expect(body.title).toBe("Sonarr imported 8 episodes of The Bear (S04E01-E08)");
    expect(body.message).toContain('S04E01 "Groundhogs"');
  });

  it("emails the report with the saved options, and one episode when the window is off", async () => {
    sendMailMock.mockResolvedValue({});
    const config = settings({
      alerts: { channels: [channel({ id: "mail", type: "email", smtp })] },
      webhooks: { subjectPrefix: "[Lab]", poster: false, facts: false },
    });
    const { results } = await sendSampleNotification(config, "radarr-grab");
    expect(results).toEqual([{ id: "mail", label: "Email (SMTP)", ok: true, detail: "sent" }]);
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail.subject).toBe("[Lab] [Radarr] Grabbed: Dune: Part Three (2026)");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain('role="table"');
    expect(mail.html).toContain("Overview");
    expect(mail.html).toContain("CtrlCenter</span> · Lab");
    sendMailMock.mockClear();
    await sendSampleNotification(
      settings({ alerts: { channels: [channel({ type: "email", smtp })] }, webhooks: { digestSeconds: 0 } }),
      "sonarr-import"
    );
    expect(sendMailMock.mock.calls[0][0].subject).toBe("[Sonarr] Imported: The Bear S04E01");
  });

  it("sends to one channel by id, even while it's switched off or not taking webhooks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const config = settings({
      alerts: {
        channels: [
          channel({ id: "a" }),
          channel({ id: "b", enabled: false, name: "Mine", url: "https://b.test", onWebhooks: false }),
        ],
      },
    });
    expect(await sendSampleNotification(config, "seerr-request", "b")).toEqual({
      results: [{ id: "b", label: "Mine", ok: true, detail: "HTTP 200" }],
    });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://b.test"]);
    // A channel missing a field is skipped, as the test skips it.
    expect(await sendSampleNotification(settings({ alerts: { channels: [channel({ id: "c", url: "" })] } }), "sonarr-health", "c")).toEqual({ results: [] });
  });

  it("attempts nothing when no channel takes inbound webhooks", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendSampleNotification(settings({ alerts: { channels: [channel({ onWebhooks: false })] } }), "sonarr-import")).toEqual({ results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("reports a failed delivery as ok:false with the reason, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));
    sendMailMock.mockRejectedValue(new Error("SMTP auth failed"));
    const config = settings({
      alerts: { channels: [channel({ id: "hook" }), channel({ id: "mail", type: "email", smtp })] },
    });
    const { results } = await sendSampleNotification(config, "sonarr-health");
    expect(results).toEqual([
      { id: "hook", label: "Webhook", ok: false, detail: "connect ECONNREFUSED" },
      { id: "mail", label: "Email (SMTP)", ok: false, detail: "SMTP auth failed" },
    ]);
  });
});

describe("processAlerts", () => {
  const apps = [
    { id: "a", name: "Alpha", url: "" },
    { id: "b", name: "Beta", url: "" },
  ];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const g = globalThis as { __ctrlcenterAlertState?: unknown; __ctrlcenterWarnState?: unknown };
    delete g.__ctrlcenterAlertState;
    delete g.__ctrlcenterWarnState;
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const hits = () => fetchMock.mock.calls.map((c) => c[0] as string);
  const prior = new Map([
    ["a", true],
    ["b", true],
  ]);

  it("sends each transition only to the channels whose filters take it", async () => {
    const config = alertsSchema.parse({
      enabled: true,
      confirmations: 1,
      channels: [
        channel({ id: "all", url: "https://all.test" }),
        channel({ id: "onlyB", url: "https://b.test", apps: ["b"] }),
        channel({ id: "upOnly", url: "https://up.test", onDown: false }),
      ],
    });
    await processAlerts(
      [
        { id: "a", up: false },
        { id: "b", up: false },
      ],
      apps,
      config,
      prior
    );
    expect(hits().sort()).toEqual(["https://all.test", "https://all.test", "https://b.test"]);

    fetchMock.mockClear();
    await processAlerts([{ id: "a", up: true }], apps, config, prior);
    expect(hits().sort()).toEqual(["https://all.test", "https://up.test"]);
  });

  it("sends warnings to the channels that take them", async () => {
    const config = alertsSchema.parse({
      enabled: true,
      confirmations: 1,
      channels: [
        channel({ id: "w", url: "https://w.test" }),
        channel({ id: "nw", url: "https://nw.test", onWarning: false }),
      ],
    });
    await processAlerts([{ id: "a", up: true, warning: "Certificate expires in 3 days" }], apps, config, prior);
    expect(hits()).toEqual(["https://w.test"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).status).toBe("warning");
    fetchMock.mockClear();
    await processAlerts([{ id: "a", up: true }], apps, config, prior);
    expect(hits()).toEqual(["https://w.test"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).status).toBe("cleared");
  });

  it("sends nothing while alerts are off", async () => {
    const config = alertsSchema.parse({ enabled: false, confirmations: 1, channels: [channel({})] });
    await processAlerts([{ id: "a", up: false }], apps, config, prior);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendNotification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sendMailMock.mockReset();
  });

  it("relays to the active channels that take inbound webhooks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const config = alertsSchema.parse({
      channels: [
        channel({ id: "yes", url: "https://yes.test" }),
        channel({ id: "no", url: "https://no.test", onWebhooks: false }),
        channel({ id: "off", url: "https://off.test", enabled: false }),
      ],
    });
    expect(anyChannelReady(config)).toBe(true);
    await sendNotification(config, { title: "Grabbed" });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://yes.test"]);
  });

  it("reports no channel when none takes inbound webhooks", () => {
    const config = alertsSchema.parse({ channels: [channel({ onWebhooks: false })] });
    expect(anyChannelReady(config)).toBe(false);
  });

  it("emails the event as a report with its [App] Event subject (#345)", async () => {
    sendMailMock.mockResolvedValue({});
    const config = alertsSchema.parse({
      channels: [channel({ type: "email", smtp: { host: "smtp.example.com", from: "a@x", to: "b@y" } })],
    });
    const n = parseArrWebhook("sonarr", {
      eventType: "Grab",
      series: { title: "The Bear" },
      episodes: [{ seasonNumber: 4, episodeNumber: 3 }],
    });
    await sendNotification(config, n!, { at: 0, timeZone: "UTC", siteTitle: "Home" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = sendMailMock.mock.calls[0][0];
    expect(mail).toMatchObject({ from: "a@x", to: "b@y", subject: "[Sonarr] Grabbed: The Bear S04E03" });
    expect(mail.html).toContain("CtrlCenter</span> · Home");
    expect(mail.text).toContain("SONARR · GRABBED");
  });
});
