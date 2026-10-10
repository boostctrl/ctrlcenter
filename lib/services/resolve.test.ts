import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIntegration } from "./resolve";
import { integrationLabels } from "./ids";
import { withoutEnvSecrets } from "../secrets";
import { integrationSchema } from "../schema";

// Credentials as clients use them (#300).
const sonarr = (over: Record<string, unknown> = {}) =>
  integrationSchema.parse({ id: "sonarr", type: "sonarr", url: "http://s.lan", apiKey: "stored", ...over });

afterEach(() => vi.unstubAllEnvs());

describe("resolveIntegration", () => {
  it("expands ${ENV} references in every text field; an unset one is empty", () => {
    vi.stubEnv("S_HOST", "s.lan:8989");
    vi.stubEnv("S_KEY", "k-env");
    const r = resolveIntegration(sonarr({ id: "x", url: "http://${S_HOST}", apiKey: "${S_KEY}", username: "${NOPE}" }));
    expect(r).toMatchObject({ url: "http://s.lan:8989", apiKey: "k-env", username: "" });
  });

  it("lets the pre-3.0 variable beat the stored secret only for the id = type integration", () => {
    vi.stubEnv("CTRLCENTER_SONARR_KEY", "legacy");
    expect(resolveIntegration(sonarr()).apiKey).toBe("legacy");
    expect(resolveIntegration(sonarr({ id: "sonarr-4k" })).apiKey).toBe("stored");
    // A login type's variable applies to its password, not an API key.
    vi.stubEnv("CTRLCENTER_QBITTORRENT_PASS", "qb-legacy");
    const qb = resolveIntegration(
      integrationSchema.parse({ id: "qbittorrent", type: "qbittorrent", password: "p", apiKey: "a" })
    );
    expect(qb).toMatchObject({ password: "qb-legacy", apiKey: "a" });
  });

  it("expands nothing from the environment inside withoutEnvSecrets", async () => {
    vi.stubEnv("S_KEY", "k-env");
    vi.stubEnv("CTRLCENTER_SONARR_KEY", "legacy");
    const r = await withoutEnvSecrets(async () => resolveIntegration(sonarr({ apiKey: "${S_KEY}" })));
    expect(r.apiKey).toBe("");
    const typed = await withoutEnvSecrets(async () => resolveIntegration(sonarr({ apiKey: "typed" })));
    expect(typed.apiKey).toBe("typed");
  });
});

describe("integrationLabels", () => {
  it("names each by its name or type, numbering repeats", () => {
    const list = [sonarr(), sonarr({ id: "b" }), sonarr({ id: "c", name: "Sonarr 4K" })];
    expect(integrationLabels(list)).toEqual({ sonarr: "Sonarr", b: "Sonarr 2", c: "Sonarr 4K" });
  });
});
