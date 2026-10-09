import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { useScratchConfig, request, params } from "@/lib/testing/routes";
import { lastPushAt, resetPushState } from "@/lib/push";

// Push checks (#294): a public route gated only by the app's token.
let GET: typeof import("./route").GET;
let POST: typeof import("./route").POST;

const TOKEN = "Zm9vYmFyYmF6cXV4cXV1eA";

beforeAll(async () => {
  const configPath = await useScratchConfig();
  await fs.writeFile(
    configPath,
    YAML.dump({
      apps: [
        { id: "backup", name: "Backup", url: "https://backup.test", checkType: "push", pushToken: TOKEN },
        // A token on an app that isn't a push check doesn't count.
        { id: "web", name: "Web", url: "https://web.test", checkType: "http", pushToken: "old-token" },
      ],
    }),
    "utf8"
  );
  ({ GET, POST } = await import("./route"));
});

beforeEach(() => resetPushState(0));

let ip = 0;
const ping = (handler: typeof GET, token: string) =>
  handler(
    request(`/api/push/${token}`, {
      method: handler === GET ? "GET" : "POST",
      headers: { "sec-fetch-site": "cross-site", "x-forwarded-for": `198.51.100.${++ip}` },
    }),
    params({ token })
  );

describe("/api/push/[token]", () => {
  it("records a ping for the matching app, by GET or POST", async () => {
    expect((await ping(GET, TOKEN)).status).toBe(200);
    expect(lastPushAt("backup")).toBeGreaterThan(0);
    resetPushState(0);
    expect((await ping(POST, TOKEN)).status).toBe(200);
    expect(lastPushAt("backup")).toBeGreaterThan(0);
  });

  it("gives one 404 for an unknown token, or one on a non-push app", async () => {
    expect((await ping(GET, "nope")).status).toBe(404);
    expect((await ping(GET, "old-token")).status).toBe(404);
    expect(lastPushAt("web")).toBe(0);
  });
});
