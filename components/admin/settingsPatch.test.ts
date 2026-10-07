import { describe, it, expect } from "vitest";
import { settingsSchema } from "@/lib/schema";
import { settingsPatch } from "./settingsPatch";

describe("settingsPatch", () => {
  const base = settingsSchema.parse({});

  it("carries only the top-level keys that changed", () => {
    const next = { ...base, title: "New title", theme: { ...base.theme, mode: "dark" as const } };
    expect(settingsPatch(base, next)).toEqual({ title: "New title", theme: next.theme });
  });

  it("is empty when nothing changed, even for fresh-but-equal objects", () => {
    expect(settingsPatch(base, structuredClone(base))).toEqual({});
  });

  it("leaves untouched sections (like the layout) out of the save", () => {
    const next = { ...base, alerts: { ...base.alerts, enabled: true } };
    expect(Object.keys(settingsPatch(base, next))).toEqual(["alerts"]);
  });
});
