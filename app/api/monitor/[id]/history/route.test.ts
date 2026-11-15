import { describe, it, expect, beforeAll } from "vitest";
import { adminSession, memberSession, request, useScratchConfig } from "@/lib/testing/routes";

// An integration's recorded history (#530): admin-only, and only for an
// integration that exists.
let GET: typeof import("./route").GET;
let admin: string;

beforeAll(async () => {
  // A 2.x-shaped config: its qBittorrent becomes the integration "qbittorrent".
  await useScratchConfig("settings:\n  integrations:\n    qbittorrent:\n      enabled: true\n      url: http://qb.lan\n");
  ({ GET } = await import("./route"));
  admin = await adminSession();
  const { recordSnapshot } = await import("@/lib/monitor-history");
  recordSnapshot("qbittorrent", "qbittorrent", { downSpeed: 10, upSpeed: 1 });
});

const get = (id: string, session?: string, range = "") =>
  GET(request(`/api/monitor/${id}/history${range}`, { session }), { params: Promise.resolve({ id }) });

describe("GET /api/monitor/[id]/history", () => {
  it("serves the last hour, or the day, to an admin", async () => {
    const hour = await (await get("qbittorrent", admin)).json();
    expect(hour.range).toBe("hour");
    expect(hour.series.down.at(-1)).toBe(10);
    expect((await (await get("qbittorrent", admin, "?range=day")).json()).at).toHaveLength(96);
  });

  it("refuses anyone else, and an integration that doesn't exist", async () => {
    expect((await get("qbittorrent")).status).toBe(401);
    expect((await get("qbittorrent", await memberSession("rae"))).status).toBe(401);
    expect((await get("nope", admin)).status).toBe(404);
  });
});
