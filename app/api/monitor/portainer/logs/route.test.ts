import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import * as YAML from "js-yaml";
import { useScratchConfig, request, adminSession } from "@/lib/testing/routes";
import { FOUNDING_ACCOUNT_ID } from "@/lib/schema";

// The log tail's container id goes into a Docker API path (#379): anything
// but a real id is refused before Portainer is asked, so this read-only route
// can't be steered to another Docker endpoint (inspect, with its env secrets).
let GET: typeof import("./route").GET;
let session: string;

const CONTAINER = "4a3f1b2c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a";

const logs = (container: string) =>
  GET(
    request(
      `/api/monitor/portainer/logs?integration=portainer&endpoint=2&container=${encodeURIComponent(container)}`,
      { session }
    )
  );

function stubPortainer() {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response("line one\n"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  // A 2.x-shaped config migrates to an integration with id "portainer" (#300).
  await useScratchConfig(
    YAML.dump({
      settings: {
        integrations: {
          portainer: { enabled: true, url: "http://portainer.lan", apiKey: "k", allowActions: true },
        },
      },
    })
  );
  vi.stubEnv("ADMIN_PASSWORD", "pw");
  ({ GET } = await import("./route"));
  session = await adminSession();
  // The log tail sits behind the same gates as the actions, the second
  // factor included (#367).
  const { activateTotp } = await import("@/lib/config");
  await activateTotp(FOUNDING_ACCOUNT_ID, "JBSWY3DPEHPK3PXP", []);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/monitor/portainer/logs", () => {
  it("refuses anything but a container id, before any request", async () => {
    const fetchMock = stubPortainer();
    for (const container of [
      // Read the container's inspect output instead of its logs.
      "abc/json?",
      `${CONTAINER}/json?`,
      "../../info?",
      "x/../../images/json?",
      "abc/def",
      "z".repeat(64),
      "",
    ]) {
      expect((await logs(container)).status, container).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tails a real container id's logs", async () => {
    const fetchMock = stubPortainer();
    const res = await logs(CONTAINER);
    expect(res.status).toBe(200);
    expect((await res.json()).logs).toBe("line one\n");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      new RegExp(`^http://portainer\\.lan/api/endpoints/2/docker/containers/${CONTAINER}/logs\\?`)
    );
  });
});
