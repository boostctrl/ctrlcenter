import { describe, it, expect } from "vitest";
import { configSchema, type Config } from "../schema";
import { restoreImportSecrets, stripAuth, stripExportSecrets, stripSecrets } from "./redact";

// A backup without secrets (#366), restoring one over what the instance
// holds, and what the public config keeps.
const CAL_URL = "https://calendar.google.test/calendar/ical/me/private-tok-cal/basic.ics";
const calendarOf = (c: { widgets: Config["widgets"] }) => c.widgets.find((w) => w.id === "cal")!;

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
    // A Google "secret address" is a credential in itself (#380).
    widgets: [{ id: "cal", type: "calendar", url: CAL_URL, username: "me", password: "cal-pw" }],
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
    expect(calendarOf(out)).toMatchObject({ url: "", username: "", password: "" });
    expect(JSON.stringify(out)).not.toMatch(/hunter2|tok-|cal-pw/);
  });
});

describe("stripSecrets", () => {
  it("keeps a calendar's address in the public config, for the server's own fetch (#380)", () => {
    // The board's fetch and the nav's calendar link read it here; a visitor's
    // page gets only the widget's public shape (lib/widgets/public.ts).
    expect(calendarOf(stripSecrets(stripAuth(config())))).toMatchObject({ url: CAL_URL, username: "", password: "" });
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
    expect(calendarOf(out)).toMatchObject({ url: CAL_URL, username: "me", password: "cal-pw" });

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
