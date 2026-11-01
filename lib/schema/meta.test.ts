import { describe, it, expect } from "vitest";
import { z } from "zod";
import { redactForAdmin, redactSecrets, restoreAdminSecrets, SECRET_PLACEHOLDER, secretFields } from "./meta";
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

// Every field path under `schema`, with whether a secret mark covers it.
function fields(schema: z.ZodType, path: string[] = [], covered = false): { path: string; covered: boolean }[] {
  const stack = unwrap(schema);
  const marked = covered || stack.some((s) => secretFields.has(s));
  const base = stack[stack.length - 1];
  const item = lenientItems.get(base) ?? (base instanceof z.ZodArray ? (base.element as z.ZodType) : undefined);
  if (item) return fields(item, [...path, "[]"], marked);
  if (base instanceof z.ZodUnion) {
    return (base.options as z.ZodType[]).flatMap((o) => fields(o, path, marked));
  }
  if (base instanceof z.ZodObject) {
    return Object.entries(base.shape as Record<string, z.ZodType>).flatMap(([k, v]) =>
      fields(v, [...path, k], marked)
    );
  }
  return [{ path: path.join("."), covered: marked }];
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
      webhooks: { sonarr: { enabled: true, token: "abc" } },
    });
    const out = redactSecrets(settingsSchema, settings);
    expect(out.webhooks.sonarr).toMatchObject({ enabled: false, token: "" });
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
    expect(view.webhooks.sonarr).toEqual({ enabled: true, token: SECRET_PLACEHOLDER });
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
