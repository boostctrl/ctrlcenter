import { describe, it, expect, beforeAll, vi } from "vitest";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";
import { integrationSchema } from "@/lib/schema";

// "Test connection" (#300): env references and the legacy variable only reach
// the saved URL of the integration being edited.
let route: typeof import("./route");
let session: string;

beforeAll(async () => {
  await useScratchConfig();
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  route = await import("./route");
  session = await adminSession();
  const { replaceIntegrations } = await import("@/lib/config");
  await replaceIntegrations([
    integrationSchema.parse({ id: "sonarr", type: "sonarr", url: "http://saved.lan:8989", apiKey: "${S_KEY}" }),
  ]);
});

const probe = (body: Record<string, unknown>) =>
  route.POST(request("/api/monitor/test", { method: "POST", body: { service: "sonarr", ...body }, session }));

// The key the probe sent, read off the stubbed fetch.
function stubFetch() {
  const keys: (string | null)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("X-Api-Key"));
      return Response.json({ version: "4.0" });
    })
  );
  return keys;
}

describe("POST /api/monitor/test", () => {
  it("expands references for the integration's own saved URL", async () => {
    vi.stubEnv("S_KEY", "from-env");
    const keys = stubFetch();
    await probe({ integration: "sonarr", url: "http://saved.lan:8989/", apiKey: "${S_KEY}" });
    expect(keys[0]).toBe("from-env");
  });

  it("expands nothing for a typed URL, or another integration's", async () => {
    vi.stubEnv("S_KEY", "from-env");
    vi.stubEnv("CTRLCENTER_SONARR_KEY", "legacy");
    let keys = stubFetch();
    await probe({ integration: "sonarr", url: "http://evil.example", apiKey: "${S_KEY}" });
    expect(keys[0]).toBe("");
    keys = stubFetch();
    await probe({ integration: "new-one", url: "http://saved.lan:8989", apiKey: "${S_KEY}" });
    expect(keys[0]).toBe("");
  });
});
