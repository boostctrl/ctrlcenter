import { describe, it, expect } from "vitest";
import { SAMPLE_AT, SAMPLE_IDS, SAMPLE_LABELS, sampleNotification, type SampleId } from "./notification-samples";
import { buildNotificationEmail } from "./webhook-email";
import type { NotificationContext, ReportOptions } from "./webhooks";

// The preview's sample events (#347): built by the real parsers, rendered
// by the real renderer, stable from one render to the next.
const ctx: NotificationContext = { at: SAMPLE_AT, timeZone: "Europe/Amsterdam", siteTitle: "Home" };
const POSTER = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E";
const render = (id: SampleId, options: ReportOptions = {}, digest = true) =>
  buildNotificationEmail(sampleNotification(id, { digest, posterUrl: POSTER }), { ...ctx, options });
const fact = (id: SampleId, label: string, digest = true) =>
  sampleNotification(id, { digest }).report?.facts.find((f) => f.label === label)?.value;

describe("sampleNotification", () => {
  it("renders every sample under every option combination within the subject cap", () => {
    for (const id of SAMPLE_IDS) {
      expect(SAMPLE_LABELS[id]).toBeTruthy();
      for (const poster of [true, false])
        for (const facts of [true, false])
          for (const synopsis of [true, false])
            for (const subjectPrefix of ["", "[Home]"]) {
              const { subject, html, text } = render(id, { poster, facts, synopsis, subjectPrefix });
              expect(subject.length).toBeLessThanOrEqual(78);
              expect(html.startsWith("<!doctype html>")).toBe(true);
              expect(text).toContain("CtrlCenter · Home");
            }
    }
  });

  it("merges the season import as the burst store would, or sends one episode when the window is off", () => {
    const merged = sampleNotification("sonarr-import", { digest: true });
    expect(merged.title).toBe("Sonarr imported 8 episodes of The Bear (S04E01-E08)");
    expect(fact("sonarr-import", "Episodes")?.split("\n")).toHaveLength(8);
    expect(fact("sonarr-import", "Quality")).toBe("WEBDL-1080p");
    expect(render("sonarr-import").subject).toBe("[Sonarr] Imported: The Bear S04E01-E08");
    const single = sampleNotification("sonarr-import", { digest: false });
    expect(single.title).toBe("Sonarr imported: The Bear S04E01");
    expect(fact("sonarr-import", "Episodes", false)).toBe('S04E01 "Groundhogs"');
    expect(render("sonarr-import", {}, false).subject).toBe("[Sonarr] Imported: The Bear S04E01");
  });

  it("describes the other samples: a grab with a release line and synopsis, a request, a health cut", () => {
    expect(render("radarr-grab").subject).toBe("[Radarr] Grabbed: Dune: Part Three (2026)");
    expect(fact("radarr-grab", "Release")).toMatch(/^Dune\.Part\.Three/);
    expect(fact("radarr-grab", "Custom formats")).toBe("+1,250 (Remux Tier 01, DV HDR10+, TrueHD Atmos)");
    expect(sampleNotification("radarr-grab").report?.messageLabel).toBe("Overview");
    expect(render("seerr-request").subject).toBe("[Seerr] New request: Wicked (2024) by mara");
    expect(fact("seerr-request", "Requested by")).toBe("mara");
    expect(fact("seerr-request", "Status")).toBe("Pending");
    const health = render("sonarr-health");
    expect(health.subject).toBe("[Sonarr] Health warning: Indexers unavailable due to…");
    expect(sampleNotification("sonarr-health").report?.image).toBeUndefined();
  });

  it("shows the poster it is given, none by default, and never the stand-in", () => {
    for (const id of ["sonarr-import", "radarr-grab", "seerr-request"] as const) {
      expect(JSON.stringify(sampleNotification(id, { digest: true }))).not.toContain("preview.invalid");
      expect(buildNotificationEmail(sampleNotification(id, { digest: true }), ctx).html).not.toContain("<img");
      const withPoster = render(id);
      expect(withPoster.html).toContain(`<img src="${POSTER}"`);
      expect(withPoster.html).not.toContain("preview.invalid");
    }
  });

  it("drops the poster, the facts or the synopsis when an option is off", () => {
    const full = render("radarr-grab");
    expect(full.html).toContain("<img");
    expect(full.html).toContain('role="table"');
    expect(full.html).toContain("Overview");
    expect(render("radarr-grab", { poster: false }).html).not.toContain("<img");
    expect(render("radarr-grab", { facts: false }).html).not.toContain('role="table"');
    const noSynopsis = render("radarr-grab", { synopsis: false });
    expect(noSynopsis.html).not.toContain("Overview");
    expect(noSynopsis.text).not.toContain("OVERVIEW");
  });

  it("leads the subject with the prefix, header-cleaned, within the cap", () => {
    const prefixed = render("sonarr-import", { subjectPrefix: "[Home]" });
    expect(prefixed.subject).toBe("[Home] [Sonarr] Imported: The Bear S04E01-E08");
    const injected = render("sonarr-health", { subjectPrefix: "\r\nBcc: evil@x" });
    expect(injected.subject).not.toMatch(/[\r\n]/);
    expect(injected.subject.startsWith("Bcc: evil@x [Sonarr] Health warning: ")).toBe(true);
    expect(injected.subject.length).toBeLessThanOrEqual(78);
    const long = render("radarr-grab", { subjectPrefix: "[A fairly long mailbox rule prefix tag]" });
    expect(long.subject.length).toBeLessThanOrEqual(78);
  });

  it("renders the same bytes twice, and a one-line ASCII title for the push channels", () => {
    for (const id of SAMPLE_IDS) {
      expect(render(id).html).toBe(render(id).html);
      const n = sampleNotification(id, { digest: true });
      expect(n.title).toMatch(/^[\x20-\x7E]*$/);
      expect(n.digest).toBeUndefined();
    }
    expect(JSON.stringify(sampleNotification("seerr-request"))).not.toContain("mara@example.com");
  });
});
