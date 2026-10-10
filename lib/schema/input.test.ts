import { describe, it, expect } from "vitest";
import {
  announcementUpdateSchema,
  newInstance,
  settingsInputSchema,
  settingsSchema,
  weatherUpdateSchema,
  webhooksUpdateSchema,
  widgetInstancesUpdateSchema,
  alertsUpdateSchema,
} from "../schema";

// Admin input schemas derived from the stored ones (#287).
describe("derived input schemas", () => {
  it("leave out what a patch doesn't send — no defaults filled in", () => {
    expect(weatherUpdateSchema.parse({})).toEqual({});
    expect(alertsUpdateSchema.parse({ confirmations: 3 })).toEqual({ confirmations: 3 });
    // A burst-window change (#346) carries no service tokens for the merge
    // to overwrite.
    expect(webhooksUpdateSchema.parse({})).toEqual({});
    expect(webhooksUpdateSchema.parse({ digestSeconds: 0 })).toEqual({ digestSeconds: 0 });
    // One report option (#347) writes none of its siblings.
    expect(webhooksUpdateSchema.parse({ poster: false })).toEqual({ poster: false });
    expect(webhooksUpdateSchema.parse({ subjectPrefix: "[Home]" })).toEqual({ subjectPrefix: "[Home]" });
  });

  it("keep the stored bounds (#346, #347)", () => {
    for (const bad of [{ digestSeconds: 301 }, { digestSeconds: 1.5 }, { subjectPrefix: "x".repeat(41) }, { facts: "yes" }]) {
      expect(webhooksUpdateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(webhooksUpdateSchema.safeParse({ subjectPrefix: "x".repeat(40) }).success).toBe(true);
  });

  it("are strict where the stored schema is lenient", () => {
    // Stored, a bad tone coerces to the default; as input it's rejected.
    expect(announcementUpdateSchema.safeParse({ tone: "loud" }).success).toBe(false);
  });

  it("require whole list items, a tagged union's included (#297)", () => {
    const card = { ...newInstance("feed", "f1"), urls: [] };
    expect(widgetInstancesUpdateSchema.safeParse([card]).success).toBe(true);
    const noId: Partial<typeof card> = { ...card };
    delete noId.id;
    expect(widgetInstancesUpdateSchema.safeParse([noId]).success).toBe(false);
  });

  it("keep their input-only rules", () => {
    expect(weatherUpdateSchema.safeParse({ latitude: 91 }).success).toBe(false);
    const disk = { label: "d", path: "/d" };
    const stats = { ...newInstance("systemStats", "s"), disks: Array(9).fill(disk) };
    expect(widgetInstancesUpdateSchema.safeParse([stats]).success).toBe(false);
    const ch = settingsSchema.parse({ alerts: { channels: [{ id: "c", type: "gotify" }] } }).alerts
      .channels[0];
    expect(alertsUpdateSchema.safeParse({ channels: [{ ...ch, url: "https://g.test" }] }).success).toBe(true);
    expect(alertsUpdateSchema.safeParse({ channels: [{ ...ch, url: "javascript:x" }] }).success).toBe(false);
  });

  it("accept every stored settings section, so a new one can't be silently dropped", () => {
    expect(Object.keys(settingsInputSchema.shape).sort()).toEqual(
      Object.keys(settingsSchema.shape).sort()
    );
  });
});
