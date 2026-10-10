import { describe, it, expect } from "vitest";
import { z } from "zod";
import { redactSecrets, secretFields } from "./meta";
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
    // credentials, a notes widget keeps its content.
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
