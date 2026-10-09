import { describe, it, expect } from "vitest";
import {
  announcementUpdateSchema,
  newInstance,
  settingsInputSchema,
  settingsSchema,
  weatherUpdateSchema,
  widgetInstancesUpdateSchema,
  alertsUpdateSchema,
} from "../schema";

// Admin input schemas derived from the stored ones (#287).
describe("derived input schemas", () => {
  it("leave out what a patch doesn't send — no defaults filled in", () => {
    expect(weatherUpdateSchema.parse({})).toEqual({});
    expect(alertsUpdateSchema.parse({ email: { host: "smtp.test" } })).toEqual({
      email: { host: "smtp.test" },
    });
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
