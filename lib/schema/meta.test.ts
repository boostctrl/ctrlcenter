import { describe, it, expect } from "vitest";
import { z } from "zod";
import { redactSecrets, secretFields } from "./meta";
import { lenientItems } from "./shared";
import { settingsSchema } from "./settings";
import { appItemSchema } from "./apps-bookmarks";

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
  if (base instanceof z.ZodObject) {
    return Object.entries(base.shape as Record<string, z.ZodType>).flatMap(([k, v]) =>
      fields(v, [...path, k], marked)
    );
  }
  return [{ path: path.join("."), covered: marked }];
}

describe("secret marks", () => {
  it("cover every settings field that looks like a credential", () => {
    const credential = /(pass(word)?|token|apikey|secret|username|user)$/i;
    // Every settings and app field named like a credential.
    const uncovered = [...fields(settingsSchema), ...fields(appItemSchema, ["apps[]"])]
      .filter((f) => credential.test(f.path.split(".").pop()!))
      .filter((f) => !f.covered)
      .map((f) => f.path);
    expect(uncovered, "mark these with secretFields (lib/schema/meta.ts)").toEqual([]);
  });

  it("blank marked strings and neutralize marked sections", () => {
    const settings = settingsSchema.parse({
      calendar: { url: "https://cal.test", username: "me", password: "pw" },
      integrations: { sonarr: { enabled: true, url: "http://10.0.0.5", apiKey: "k" } },
    });
    const out = redactSecrets(settingsSchema, settings);
    expect(out.calendar).toMatchObject({ url: "https://cal.test", username: "", password: "" });
    expect(out.integrations.sonarr).toMatchObject({ enabled: false, url: "", apiKey: "" });
    // The input is left alone.
    expect(settings.calendar.password).toBe("pw");
  });
});
