import { describe, it, expect } from "vitest";
import {
  parseArrWebhook,
  parseSeerrWebhook,
  parseWebhook,
} from "./webhooks";
import { buildNotificationRequest, buildNotificationEmail } from "./alerts";

describe("parseArrWebhook (Sonarr/Radarr)", () => {
  it("summarizes a Sonarr grab with series + episode codes", () => {
    const n = parseArrWebhook("sonarr", {
      eventType: "Grab",
      series: { title: "The Bear" },
      episodes: [{ seasonNumber: 4, episodeNumber: 3 }],
      release: { quality: "WEBDL-1080p" },
    });
    expect(n?.title).toBe("Sonarr grabbed The Bear – S04E03");
    expect(n?.body).toBe("WEBDL-1080p");
  });

  it("summarizes a Radarr import with movie + year", () => {
    const n = parseArrWebhook("radarr", {
      eventType: "Download",
      movie: { title: "Dune: Part Three", year: 2026 },
      isUpgrade: true,
    });
    expect(n?.title).toBe("Radarr imported Dune: Part Three (2026)");
    expect(n?.body).toMatch(/upgrade/i);
  });

  it("carries a health issue's level and message", () => {
    const n = parseArrWebhook("sonarr", {
      eventType: "HealthIssue",
      level: "warning",
      message: "Indexer unavailable",
    });
    expect(n?.title).toBe("Sonarr health warning");
    expect(n?.body).toBe("Indexer unavailable");
  });

  it("labels a Test event clearly", () => {
    expect(parseArrWebhook("radarr", { eventType: "Test" })?.title).toBe(
      "Radarr webhook test"
    );
  });

  it("falls back to a humanized event type for unknown events", () => {
    const n = parseArrWebhook("sonarr", {
      eventType: "SeriesAdd",
      series: { title: "Silo" },
    });
    expect(n?.title).toBe("Sonarr: Series add");
    expect(n?.body).toBe("Silo");
  });

  it("returns null when there's no eventType", () => {
    expect(parseArrWebhook("sonarr", {})).toBeNull();
    expect(parseArrWebhook("radarr", null)).toBeNull();
  });
});

describe("parseSeerrWebhook (Overseerr/Jellyseerr)", () => {
  it("labels a pending request with its subject", () => {
    const n = parseSeerrWebhook({
      notification_type: "MEDIA_PENDING",
      subject: "Wicked (2024)",
      message: "Requested by Sam",
    });
    expect(n?.title).toBe("Seerr — new request needs approval: Wicked (2024)");
    expect(n?.body).toBe("Requested by Sam");
  });

  it("labels availability", () => {
    expect(
      parseSeerrWebhook({ notification_type: "MEDIA_AVAILABLE", subject: "Flow" })
        ?.title
    ).toBe("Seerr — now available: Flow");
  });

  it("labels a test notification", () => {
    expect(
      parseSeerrWebhook({ notification_type: "TEST_NOTIFICATION" })?.title
    ).toBe("Seerr webhook test");
  });

  it("returns null without a notification_type", () => {
    expect(parseSeerrWebhook({})).toBeNull();
  });
});

describe("parseWebhook dispatch", () => {
  it("routes seerr to the Seerr parser", () => {
    expect(
      parseWebhook("seerr", { notification_type: "MEDIA_APPROVED", subject: "X" })
        ?.title
    ).toContain("request approved");
  });
  it("routes sonarr/radarr to the arr parser", () => {
    expect(parseWebhook("radarr", { eventType: "Test" })?.title).toBe(
      "Radarr webhook test"
    );
  });
});

describe("notification channel shaping", () => {
  const n = { title: "Sonarr grabbed The Bear – S04E03", body: "WEBDL-1080p" };

  it("Discord posts the title + body as content", () => {
    const req = buildNotificationRequest("discord", "https://d/hook", n);
    expect(JSON.parse(req.init.body as string)).toEqual({
      content: "Sonarr grabbed The Bear – S04E03\nWEBDL-1080p",
    });
  });

  it("ntfy sends an ASCII-safe Title header and a non-empty body", () => {
    const req = buildNotificationRequest("ntfy", "https://ntfy/topic", {
      title: "Radarr webhook test",
    });
    const headers = req.init.headers as Record<string, string>;
    expect(headers.Title).toBe("Radarr webhook test");
    // No detail → body falls back to the title so ntfy never gets an empty body.
    expect(req.init.body).toBe("Radarr webhook test");
  });

  it("generic posts a structured JSON envelope", () => {
    const req = buildNotificationRequest("generic", "https://x/hook", {
      title: "T",
      body: "B",
      url: "https://u",
    });
    const payload = JSON.parse(req.init.body as string);
    expect(payload).toMatchObject({ title: "T", message: "B", url: "https://u" });
  });

  it("email subject is the title, body carries the detail", () => {
    const mail = buildNotificationEmail({ title: "New request", body: "Wicked" });
    expect(mail.subject).toBe("New request");
    expect(mail.text).toContain("Wicked");
    expect(mail.html).toContain("New request");
  });
});
