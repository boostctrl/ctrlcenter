import { describe, it, expect } from "vitest";
import {
  announcementUpdateSchema,
  calendarUpdateSchema,
  feedUpdateSchema,
  settingsInputSchema,
  settingsSchema,
  systemStatsUpdateSchema,
  alertsUpdateSchema,
} from "../schema";

// Admin input schemas derived from the stored ones (#287).
describe("derived input schemas", () => {
  it("leave out what a patch doesn't send — no defaults filled in", () => {
    expect(calendarUpdateSchema.parse({})).toEqual({});
    expect(alertsUpdateSchema.parse({ email: { host: "smtp.test" } })).toEqual({
      email: { host: "smtp.test" },
    });
  });

  it("are strict where the stored schema is lenient", () => {
    // Stored, a bad tone coerces to the default; as input it's rejected.
    expect(announcementUpdateSchema.safeParse({ tone: "loud" }).success).toBe(false);
  });

  it("require whole list items", () => {
    const card = { id: "f1", enabled: true, urls: [], count: 6, title: "", summaries: false };
    expect(feedUpdateSchema.safeParse(card).success).toBe(true);
    const { id: _id, ...noId } = card;
    expect(feedUpdateSchema.safeParse(noId).success).toBe(false);
  });

  it("keep their input-only rules", () => {
    expect(calendarUpdateSchema.safeParse({ url: "ftp://x" }).success).toBe(false);
    const disk = { label: "d", path: "/d" };
    expect(systemStatsUpdateSchema.safeParse({ disks: Array(9).fill(disk) }).success).toBe(false);
  });

  it("accept every stored settings section, so a new one can't be silently dropped", () => {
    expect(Object.keys(settingsInputSchema.shape).sort()).toEqual(
      Object.keys(settingsSchema.shape).sort()
    );
  });
});
