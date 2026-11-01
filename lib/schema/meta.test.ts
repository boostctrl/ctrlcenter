import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  redactForAdmin,
  redactForExport,
  redactSecrets,
  restoreAdminSecrets,
  restoreSecrets,
  SECRET_PLACEHOLDER,
  secretFields,
} from "./meta";
import { lenientItems } from "./shared";
import { settingsSchema } from "./settings";
import { appItemSchema } from "./apps-bookmarks";
import { widgetInstanceSchema } from "./instances";

// Schema-driven redaction (#287).

const unwrap = (s: z.ZodType): z.ZodType[] => {
  const out = [s];
  while (s instanceof z.ZodDefault || s instanceof z.ZodCatch || s instanceof z.ZodOptional) {
    s = s.unwrap() as z.ZodType;
    out.push(s);
  }
  return out;
};

// Every field path under `schema`, with whether a "blank" mark of its own
// covers it. An "all" mark on the section around it doesn't count: that keeps
// the section from a visitor, but a backup without secrets blanks only the
// fields marked within it (#437), so each credential needs its own mark.
function fields(schema: z.ZodType, path: string[] = []): { path: string; covered: boolean }[] {
  const stack = unwrap(schema);
  const base = stack[stack.length - 1];
  const item = lenientItems.get(base) ?? (base instanceof z.ZodArray ? (base.element as z.ZodType) : undefined);
  if (item) return fields(item, [...path, "[]"]);
  if (base instanceof z.ZodUnion) {
    return (base.options as z.ZodType[]).flatMap((o) => fields(o, path));
  }
  if (base instanceof z.ZodObject) {
    return Object.entries(base.shape as Record<string, z.ZodType>).flatMap(([k, v]) =>
      fields(v, [...path, k])
    );
  }
  return [{ path: path.join("."), covered: stack.some((s) => secretFields.get(s)?.redact === "blank") }];
}

describe("secret marks", () => {
  it("cover every settings field that looks like a credential", () => {
    // Any "…Key" (apiKey, userKey), but not a bare "key" like a search bang's.
    const credential = /(pass(word)?|token|\wkey|secret|username|user|chatid)$/i;
    // Every settings and app field named like a credential.
    const uncovered = [
      ...fields(settingsSchema),
      ...fields(appItemSchema, ["apps[]"]),
      ...fields(widgetInstanceSchema, ["widgets[]"]),
    ]
      .filter((f) => credential.test(f.path.split(".").pop()!))
      .filter((f) => !f.covered)
      .map((f) => f.path);
    expect(uncovered, "mark these with secretFields (lib/schema/meta.ts)").toEqual([]);
  });

  it("blank marked strings and neutralize marked sections", () => {
    const settings = settingsSchema.parse({
      webhooks: { subjectPrefix: "[Media]", sonarr: { enabled: true, token: "abc", url: "https://sonarr.lan" } },
    });
    const out = redactSecrets(settingsSchema, settings);
    // The whole inbound-webhook section, its Application URLs included: only
    // a backup keeps those (#437).
    expect(out.webhooks).toMatchObject({ subjectPrefix: "", sonarr: { enabled: false, token: "", url: "" } });
    // Into list entries too: an alert channel keeps its type, loses its keys.
    const alerts = settingsSchema.parse({
      alerts: {
        channels: [
          { id: "c", type: "telegram", token: "123:abc", chatId: "42", smtp: { pass: "pw", port: 25 } },
        ],
      },
    }).alerts;
    const [ch] = redactSecrets(settingsSchema, { ...settings, alerts }).alerts.channels;
    expect(ch).toMatchObject({ type: "telegram", token: "", chatId: "", smtp: { pass: "", port: 25 } });
    // A tagged union by its option (#297): a calendar widget loses its
    // credentials, a notes widget keeps its content. The calendar's address
    // is a secret for exports only (#380), so the public config keeps it.
    const calendar = widgetInstanceSchema.parse({
      id: "c",
      type: "calendar",
      url: "https://cal.test",
      username: "me",
      password: "pw",
    });
    expect(redactSecrets(widgetInstanceSchema, calendar)).toMatchObject({
      url: "https://cal.test",
      username: "",
      password: "",
    });
    const notes = widgetInstanceSchema.parse({ id: "n", type: "notes", content: "hi" });
    expect(redactSecrets(widgetInstanceSchema, notes)).toEqual(notes);
    // The input is left alone.
    expect(calendar.type === "calendar" && calendar.password).toBe("pw");
  });
});

describe("a backup without secrets (#366)", () => {
  // The inbound-webhook section is private wholesale from a visitor, but a
  // backup keeps everything in it except the tokens (#437): the Application
  // URLs and the subject prefix are settings, not secrets.
  const settings = settingsSchema.parse({
    alerts: { channels: [{ id: "hook", type: "webhook", url: "https://hooks.example/abc" }] },
    webhooks: {
      enabled: true,
      digestSeconds: 30,
      subjectPrefix: "[Media]",
      sonarr: { enabled: true, token: "tok-sonarr", url: "https://sonarr.lan" },
      radarr: { enabled: false, token: "tok-radarr", url: "https://radarr.lan" },
      seerr: { enabled: true, token: "${SEERR_TOKEN}", url: "https://seerr.lan" },
    },
  });

  it("blanks the webhook tokens and keeps the section's settings, the Application URLs among them", () => {
    const out = redactForExport(settingsSchema, settings);
    expect(out.webhooks).toEqual({
      ...settings.webhooks,
      sonarr: { enabled: true, token: "", url: "https://sonarr.lan" },
      radarr: { enabled: false, token: "", url: "https://radarr.lan" },
      // An environment reference names no secret.
      seerr: { enabled: true, token: "${SEERR_TOKEN}", url: "https://seerr.lan" },
    });
    expect([out.webhooks.enabled, out.webhooks.digestSeconds, out.webhooks.subjectPrefix]).toEqual([true, 30, "[Media]"]);
    // The marks elsewhere still apply.
    expect(out.alerts.channels[0].url).toBe("");
    expect(JSON.stringify(out)).not.toMatch(/tok-|hooks\.example/);
  });

  it("fills the tokens back from the instance on import and takes the settings as the file has them", () => {
    const exported = redactForExport(settingsSchema, settings);
    const file = {
      ...exported,
      webhooks: {
        ...exported.webhooks,
        subjectPrefix: "[Moved]",
        sonarr: { ...exported.webhooks.sonarr, url: "https://sonarr.new" },
        // A blank Application URL is the file's own value, not a gap to fill.
        radarr: { ...exported.webhooks.radarr, url: "" },
      },
    };
    const out = restoreSecrets(settingsSchema, file, settings);
    expect(out.webhooks.sonarr).toEqual({ enabled: true, token: "tok-sonarr", url: "https://sonarr.new" });
    expect(out.webhooks.radarr).toEqual({ enabled: false, token: "tok-radarr", url: "" });
    expect(out.webhooks.seerr.token).toBe("${SEERR_TOKEN}");
    expect(out.webhooks.subjectPrefix).toBe("[Moved]");
    expect(out.alerts.channels[0].url).toBe("https://hooks.example/abc");
    // A file carrying its own token keeps it.
    const own = { ...exported, webhooks: { ...exported.webhooks, sonarr: { ...exported.webhooks.sonarr, token: "tok-new" } } };
    expect(restoreSecrets(settingsSchema, own, settings).webhooks.sonarr.token).toBe("tok-new");
  });
});

describe("the admin's view of credentials (#382)", () => {
  const settings = settingsSchema.parse({
    alerts: {
      channels: [
        { id: "mail", type: "email", smtp: { host: "smtp.lan", user: "me", pass: "hunter2", from: "a@b" } },
        { id: "tg", type: "telegram", token: "123:abc", chatId: "42" },
        { id: "hook", type: "webhook", url: "https://hooks.example/abc" },
        { id: "env", type: "pushover", token: "${PUSHOVER_TOKEN}", userKey: "" },
      ],
    },
    webhooks: { enabled: true, sonarr: { enabled: true, token: "tok-sonarr" } },
  });

  it("hands the forms a placeholder for each stored credential, and nothing else changes", () => {
    const view = redactForAdmin(settingsSchema, settings);
    const [mail, tg, hook, env] = view.alerts.channels;
    expect(mail.smtp).toMatchObject({ host: "smtp.lan", user: "me", pass: SECRET_PLACEHOLDER, from: "a@b" });
    expect([tg.token, tg.chatId]).toEqual([SECRET_PLACEHOLDER, "42"]);
    expect(hook.url).toBe(SECRET_PLACEHOLDER);
    // An environment reference names no secret; an empty field stays empty.
    expect([env.token, env.userKey]).toEqual(["${PUSHOVER_TOKEN}", ""]);
    expect(view.webhooks.sonarr).toEqual({ enabled: true, token: SECRET_PLACEHOLDER, url: "" });
    expect(view.title).toBe(settings.title);
  });

  it("puts the stored value back where the placeholder comes back, and takes anything else as typed", () => {
    const view = redactForAdmin(settingsSchema, settings);
    const edited = {
      ...view,
      alerts: {
        ...view.alerts,
        channels: [
          view.alerts.channels[0],
          { ...view.alerts.channels[1], token: "" },
          { ...view.alerts.channels[2], url: "https://hooks.example/new" },
        ],
      },
    };
    const saved = restoreAdminSecrets(settingsSchema, edited, settings);
    expect(saved.alerts.channels[0].smtp.pass).toBe("hunter2");
    expect(saved.alerts.channels[1].token).toBe("");
    expect(saved.alerts.channels[2].url).toBe("https://hooks.example/new");
    expect(saved.webhooks.sonarr.token).toBe("tok-sonarr");
    // A placeholder with nothing stored behind it (a new row) stays as sent.
    const fresh = restoreAdminSecrets(settingsSchema, { alerts: { channels: [{ ...view.alerts.channels[1], id: "new" }] } }, settings);
    expect(fresh.alerts.channels[0].token).toBe(SECRET_PLACEHOLDER);
  });

  it("covers an API widget's header values and a calendar's password, not the rest", () => {
    const api = widgetInstanceSchema.parse({
      id: "a", type: "api", url: "http://x", headers: [{ name: "Authorization", value: "Bearer t" }, { name: "X", value: "" }],
    });
    const cal = widgetInstanceSchema.parse({ id: "c", type: "calendar", url: "https://cal/x.ics", username: "me", password: "pw" });
    const apiView = redactForAdmin(widgetInstanceSchema, api);
    const calView = redactForAdmin(widgetInstanceSchema, cal);
    if (apiView.type !== "api" || calView.type !== "calendar") throw new Error("type");
    expect(apiView.headers.map((h) => h.value)).toEqual([SECRET_PLACEHOLDER, ""]);
    expect(apiView.url).toBe("http://x");
    expect([calView.url, calView.username, calView.password]).toEqual(["https://cal/x.ics", "me", SECRET_PLACEHOLDER]);
    expect(restoreAdminSecrets(widgetInstanceSchema, calView, cal)).toEqual(cal);
    expect(restoreAdminSecrets(widgetInstanceSchema, apiView, api)).toEqual(api);
  });
});
