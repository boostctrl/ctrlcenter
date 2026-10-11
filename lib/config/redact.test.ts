import { describe, it, expect } from "vitest";
import { configSchema, type Config } from "../schema";
import { restoreImportSecrets, stripAuth, stripExportSecrets } from "./redact";

// A backup without secrets (#366), and restoring one over what the instance
// holds.
function config(over: Record<string, unknown> = {}): Config {
  return configSchema.parse({
    settings: {
      alerts: { channels: [{ id: "hook", type: "webhook", url: "https://hooks.example/abc" }] },
      webhooks: { enabled: true, sonarr: { enabled: true, token: "tok-sonarr" } },
    },
    integrations: [
      { id: "qb", type: "qbittorrent", url: "http://qb", username: "admin", password: "hunter2" },
      { id: "sonarr", type: "sonarr", url: "http://s", apiKey: "${SONARR_KEY}" },
    ],
    apps: [{ id: "nas", name: "NAS", url: "http://nas", pushToken: "tok-push" }],
    ...over,
  });
}

describe("stripExportSecrets", () => {
  it("blanks credentials and tokens, keeps environment references and switches", () => {
    const out = stripExportSecrets(stripAuth(config()));
    expect(out.integrations.map((i) => [i.id, i.url, i.username, i.password, i.apiKey])).toEqual([
      ["qb", "http://qb", "admin", "", ""],
      ["sonarr", "http://s", "", "", "${SONARR_KEY}"],
    ]);
    expect(out.apps[0].pushToken).toBe("");
    expect(out.settings.alerts.channels[0].url).toBe("");
    expect(out.settings.webhooks.enabled).toBe(true);
    expect(out.settings.webhooks.sonarr.enabled).toBe(true);
    expect(out.settings.webhooks.sonarr.token).toBe("");
    expect(JSON.stringify(out)).not.toMatch(/hunter2|tok-/);
  });
});

describe("restoreImportSecrets", () => {
  it("fills blanks from the stored config by id, and keeps secrets a file carries", () => {
    const stored = config();
    const incoming = stripExportSecrets(stripAuth(config())) as unknown as Config;
    incoming.integrations[0].url = "http://qb-moved";
    const out = restoreImportSecrets({ ...incoming, auth: stored.auth }, stored);
    expect(out.integrations[0]).toMatchObject({ url: "http://qb-moved", password: "hunter2" });
    expect(out.integrations[1].apiKey).toBe("${SONARR_KEY}");
    expect(out.apps[0].pushToken).toBe("tok-push");
    expect(out.settings.alerts.channels[0].url).toBe("https://hooks.example/abc");
    expect(out.settings.webhooks.sonarr.token).toBe("tok-sonarr");

    // A file with its own secrets keeps them.
    const own = config({ integrations: [{ id: "qb", type: "qbittorrent", url: "http://qb", password: "new-pw" }] });
    expect(restoreImportSecrets(own, stored).integrations[0].password).toBe("new-pw");
    // An integration the instance doesn't have stays blank.
    const fresh = restoreImportSecrets(
      config({ integrations: [{ id: "other", type: "sonarr", url: "http://o", apiKey: "" }] }),
      stored
    );
    expect(fresh.integrations[0].apiKey).toBe("");
  });
});
