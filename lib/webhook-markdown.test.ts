import { describe, expect, it } from "vitest";
import {
  MARKDOWN_MAX,
  appriseNotification,
  buildNotificationMarkdown,
  escapeMarkdown,
  markdownLink,
  quietMentions,
} from "./webhook-markdown";
import { sampleNotification } from "./notification-samples";
import type { NotificationContext, WebhookNotification, WebhookReport } from "./webhooks";

const ctx: NotificationContext = { at: Date.UTC(2026, 9, 10, 18, 42), timeZone: "UTC", siteTitle: "Lab" };
const size = (s: string) => Array.from(s).length;

const report = (over: Partial<WebhookReport> = {}): WebhookNotification => ({
  title: "Radarr grabbed: Arrival (2016)",
  report: {
    service: "radarr",
    app: "Radarr",
    eventType: "Grab",
    event: "Grabbed",
    level: "info",
    headline: "Arrival",
    subtitle: "2016 · Movie",
    summary: "Arrival (2016)",
    facts: [
      { label: "Quality", value: "Bluray-1080p" },
      { label: "Release", value: "Arrival.2016.1080p.BluRay-GRP", mono: true },
    ],
    message: "A linguist works with the military to communicate with alien lifeforms.",
    messageLabel: "Overview",
    image: { url: "https://image.tmdb.org/t/p/w500/arrival.jpg", alt: "Arrival poster" },
    link: { label: "Open in Radarr", url: "https://radarr.lan/movie/arrival" },
    ...over,
  },
});

describe("escapeMarkdown (#533)", () => {
  it("prints what formats, links or escapes as written", () => {
    expect(escapeMarkdown("M*A*S*H_ ~x~ `y` a|b [l](u) <b> \\")).toBe(
      "M\\*A\\*S\\*H\\_ \\~x\\~ \\`y\\` a\\|b \\[l\\](u) \\<b> \\\\"
    );
  });

  it("escapes a line's opening only where it would read as structure", () => {
    expect(escapeMarkdown("# Heading\n#1 Movie\n> quote\n- item\n+1,250\n1. first\n1917\n---\n===\n    code")).toBe(
      "\\# Heading\n#1 Movie\n\\> quote\n\\- item\n+1,250\n1\\. first\n1917\n\\---\n\\===\ncode"
    );
  });

  it("breaks every @ that opens a word, and Discord's own (#533, #535)", () => {
    // Talk's "@all" and a user, Matrix's "@room", a quoted Talk mention, and
    // one after the punctuation Talk still reads it behind.
    expect(quietMentions('@all hi @alice, @room "@\"group/admins\"" (.@all)')).toBe(
      '@\u200ball hi @\u200balice, @\u200broom "@\u200b\"group/admins\"" (.@\u200ball)'
    );
    expect(quietMentions("@everyone x@Here <@123> <@&9> <#7> <!date>")).toBe(
      "@\u200beveryone x@\u200bHere <\u200b@\u200b123> <\u200b@&9> <\u200b#7> <\u200b!date>"
    );
    // An address, or an @ alone, is no mention.
    expect(quietMentions("mail me@example.com @ noon")).toBe("mail me@example.com @ noon");
  });
});

describe("markdownLink", () => {
  it("links only http(s), with the destination's breaking characters encoded", () => {
    expect(markdownLink("Open [it]", "https://x.test/a b(c)")).toBe("[Open \\[it\\]](https://x.test/a%20b%28c%29)");
    expect(markdownLink("Open", "javascript:alert(1)")).toBe("javascript:alert(1)");
  });
});

describe("buildNotificationMarkdown (#532)", () => {
  it("lays out the report as the email does: head, facts, synopsis, link, footer", () => {
    expect(buildNotificationMarkdown(report(), ctx)).toBe(
      [
        "**Arrival**  \n2016 · Movie",
        "**Quality:** Bluray-1080p  \n**Release:** `Arrival.2016.1080p.BluRay-GRP`",
        "**Overview**  \n> A linguist works with the military to communicate with alien lifeforms.",
        "[Open in Radarr](https://radarr.lan/movie/arrival)",
        "CtrlCenter · Lab · relayed from Radarr · Oct 10, 2026, 6:42 PM UTC",
      ].join("\n\n")
    );
  });

  it("follows the email's switches for the facts and the synopsis", () => {
    const md = buildNotificationMarkdown(report(), { ...ctx, options: { facts: false, synopsis: false } });
    expect(md).not.toContain("Quality");
    expect(md).not.toContain("linguist");
    // Only the plot overview can spoil; a health message stays.
    const health = report({ messageLabel: "Message", message: "Disk full" });
    expect(buildNotificationMarkdown(health, { ...ctx, options: { synopsis: false } })).toContain("> Disk full");
  });

  it("puts a value of several lines under its label, and quotes every line of a message", () => {
    const md = buildNotificationMarkdown(
      report({ facts: [{ label: "Episodes", value: "S01E01 Pilot\nS01E02 Two" }], message: "One\n\n- two" }),
      ctx
    );
    expect(md).toContain("**Episodes:**  \nS01E01 Pilot  \nS01E02 Two");
    expect(md).toContain("> One  \n>  \n> \\- two");
  });

  it("escapes every payload string, so a comment can't link, format or page", () => {
    const md = buildNotificationMarkdown(
      report({
        headline: "**Bold** @everyone",
        facts: [{ label: "By", value: "[me](https://evil.test)", href: "javascript:alert(1)" }],
        message: "<@123> click [here](https://evil.test)",
        link: { label: "Open", url: "javascript:alert(1)" },
      }),
      ctx
    );
    expect(md).toContain("**\\*\\*Bold\\*\\* @\u200beveryone**");
    expect(md).toContain("**By:** \\[me\\](https://evil.test)");
    expect(md).toContain("> \\<\u200b@\u200b123> click \\[here\\](https://evil.test)");
    expect(md).not.toMatch(/\]\(javascript:/);
  });

  it("stands in for a notification without a report", () => {
    const md = buildNotificationMarkdown({ title: "Sign-in from a new address", body: "203.0.113.9", url: "https://cc.lan/admin" }, ctx);
    expect(md).toBe(
      "**Sign-in from a new address**\n\n**Message**  \n> 203.0.113.9\n\n[Open](https://cc.lan/admin)\n\nCtrlCenter · Lab · Oct 10, 2026, 6:42 PM UTC"
    );
  });

  it("keeps within Discord's cap: the synopsis gives way, then facts a line at a time", () => {
    const many = Array.from({ length: 24 }, (_, i) => `S01E${String(i + 1).padStart(2, "0")} ${"Long episode title ".repeat(5)}`);
    const big = report({
      facts: [
        { label: "Imported", value: many.join("\n") },
        { label: "Grabbed", value: many.join("\n") },
      ],
      message: "word ".repeat(400),
    });
    const md = buildNotificationMarkdown(big, ctx);
    expect(size(md)).toBeLessThanOrEqual(MARKDOWN_MAX);
    expect(md).not.toContain("Overview");
    expect(md).toMatch(/…and \d+ more\n\n\[Open in Radarr\]/);
    // Still the head and the footer, whole.
    expect(md.startsWith("**Arrival**")).toBe(true);
    expect(md.endsWith("6:42 PM UTC")).toBe(true);

    // Room for a shortened synopsis: cut, not dropped.
    const long = buildNotificationMarkdown(report({ message: "word ".repeat(500) }), ctx);
    expect(size(long)).toBeLessThanOrEqual(MARKDOWN_MAX);
    expect(long).toMatch(/> (word ){20,}/);
  });

  it("keeps every sample within the cap", () => {
    for (const id of ["sonarr-import", "radarr-grab", "seerr-request", "sonarr-health", "busy-minute"] as const) {
      const n = sampleNotification(id, { digest: true, scope: "all", posterUrl: "https://img.test/p.jpg" });
      expect(size(buildNotificationMarkdown(n, ctx))).toBeLessThanOrEqual(MARKDOWN_MAX);
    }
  });
});

describe("appriseNotification (#532)", () => {
  it("titles it with the email's subject, types it by level, and attaches the https poster", () => {
    expect(appriseNotification(report(), { ...ctx, options: { subjectPrefix: "[Lab]" } })).toMatchObject({
      title: "[Lab] [Radarr] Grabbed: Arrival (2016)",
      type: "info",
      attach: "https://image.tmdb.org/t/p/w500/arrival.jpg",
    });
    expect(appriseNotification(report({ level: "error" }), ctx).type).toBe("failure");
    expect(appriseNotification(report({ level: "success" }), ctx).type).toBe("success");
  });

  it("attaches nothing when the poster is off, or isn't https", () => {
    expect(appriseNotification(report(), { ...ctx, options: { poster: false } })).not.toHaveProperty("attach");
    const inline = report({ image: { url: "data:image/png;base64,AAAA", alt: "x" } });
    expect(appriseNotification(inline, ctx)).not.toHaveProperty("attach");
  });
});
