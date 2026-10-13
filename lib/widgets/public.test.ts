import { describe, it, expect } from "vitest";
import { newInstance, type WidgetInstanceType } from "../schema";
import { WIDGET_IDS } from "./defs";
import { PUBLIC_FIELDS, publicInstance, type PublicInstanceOf } from "./public";

// What a visitor's page carries of each widget instance (#380).
describe("publicInstance", () => {
  it("keeps an instance's id, type and listed fields, and nothing else, for every type", () => {
    for (const type of WIDGET_IDS as readonly WidgetInstanceType[]) {
      const out = publicInstance(newInstance(type, "w"));
      expect(Object.keys(out).sort(), type).toEqual(["id", "type", ...PUBLIC_FIELDS[type]].sort());
    }
  });

  it("drops what the server fetches with", () => {
    const calendar = {
      ...newInstance("calendar", "cal"),
      url: "https://calendar.google.test/private-abc/basic.ics",
      username: "me",
      password: "pw",
    };
    const feed = { ...newInstance("feed", "news"), title: "News", urls: ["https://feeds.test/rss?key=k"] };
    const stats = { ...newInstance("systemStats", "s"), title: "Server", disks: [{ label: "Media", path: "/mnt/media" }] };
    const api = { ...newInstance("api", "a"), title: "NAS", url: "http://nas.lan/?apikey=k", body: "{}" };
    expect([calendar, feed, stats, api].map(publicInstance)).toEqual([
      { id: "cal", type: "calendar" },
      { id: "news", type: "feed" },
      { id: "s", type: "systemStats", title: "Server" },
      { id: "a", type: "api", title: "NAS" },
    ]);
    // What the renderers do read comes through whole.
    const apps = { ...newInstance("apps", "apps"), title: "Media", filter: { group: "g", tag: "t", private: "hide" as const } };
    expect(publicInstance(apps)).toEqual(apps);
  });

  it("is what the renderers are typed against", () => {
    // Compile-time: a renderer can't read a field the page doesn't carry.
    const cal = publicInstance(newInstance("calendar", "c")) as PublicInstanceOf<"calendar">;
    // @ts-expect-error a calendar's address stays on the server
    expect(cal.url).toBeUndefined();
    const stats = publicInstance(newInstance("systemStats", "s")) as PublicInstanceOf<"systemStats">;
    // @ts-expect-error disk paths stay on the server
    expect(stats.disks).toBeUndefined();
    expect(stats.title).toBe("System stats");
  });
});
