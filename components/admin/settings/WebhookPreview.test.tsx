import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { alertsSchema, webhooksSchema } from "@/lib/schema";

vi.mock("@/components/PrefsProvider", async (original) => ({
  ...(await original<typeof import("@/components/PrefsProvider")>()),
  useLookPrefs: () => ({ surfaceIsLight: true }),
}));

const { default: WebhookPreview } = await import("./WebhookPreview");

// The live preview of a relayed event (#347), rendered from the draft.
const channels = alertsSchema.parse({
  channels: [
    { id: "hook", type: "webhook", name: "Chat", url: "https://hook.test" },
    { id: "mail", type: "email", smtp: { host: "smtp.test", from: "a@x", to: "b@y" }, onWebhooks: false },
    { id: "off", type: "webhook", url: "https://off.test", enabled: false },
  ],
});
const props = {
  webhooks: webhooksSchema.parse({}),
  alerts: channels,
  siteTitle: "Home",
  timeZone: "UTC",
  saving: false,
};
const srcdoc = () => screen.getByTitle(/^Email preview: /).getAttribute("srcdoc") ?? "";

describe("WebhookPreview (#347)", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("renders the season sample into a titled, fully sandboxed frame with its subject", () => {
    render(<WebhookPreview {...props} />);
    const frame = screen.getByTitle("Email preview: Season import (Sonarr)");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(srcdoc()).toContain("<title>[Sonarr] Imported: The Bear S04E01-E08</title>");
    expect(srcdoc().startsWith("<!doctype html>\n<html lang=")).toBe(true);
    expect(screen.getByText("[Sonarr] Imported: The Bear S04E01-E08")).toBeTruthy();
    expect(screen.getByText("38/78")).toBeTruthy();
    expect(screen.getByText("Sonarr imported 8 episodes of The Bear (S04E01-E08)")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("switches sample, and marks a shortened subject", async () => {
    const user = userEvent.setup();
    render(<WebhookPreview {...props} />);
    await user.selectOptions(screen.getByLabelText("Sample event"), "radarr-grab");
    expect(screen.getByText("[Radarr] Grabbed: Dune: Part Three (2026)")).toBeTruthy();
    expect(screen.getByText("Radarr grabbed: Dune: Part Three (2026)")).toBeTruthy();
    await waitFor(() => expect(srcdoc()).toContain("Dune: Part Three"));
    expect(screen.getByTitle("Email preview: Movie grab (Radarr)")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Sample event"), "sonarr-health");
    const counter = screen.getByText("53/78");
    expect(counter.className).toContain("text-status-warning");
  });

  it("re-renders from the draft options without saving anything", async () => {
    const { rerender } = render(<WebhookPreview {...props} />);
    rerender(<WebhookPreview {...props} webhooks={{ ...props.webhooks, subjectPrefix: "[Lab]", poster: false }} />);
    expect(screen.getByText("[Lab] [Sonarr] Imported: The Bear S04E01-E08")).toBeTruthy();
    await waitFor(() => expect(srcdoc()).toContain("<title>[Lab] [Sonarr] Imported: The Bear S04E01-E08</title>"));
    expect(srcdoc()).not.toContain("<img");
    rerender(<WebhookPreview {...props} webhooks={{ ...props.webhooks, digestSeconds: 0 }} />);
    expect(screen.getByText("[Sonarr] Imported: The Bear S04E01")).toBeTruthy();
    expect(screen.getByText("Sonarr imported: The Bear S04E01")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("flags a subject shortened by dropping the year, not only one cut at a word", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WebhookPreview {...props} />);
    await user.selectOptions(screen.getByLabelText("Sample event"), "radarr-grab");
    const whole = screen.getByText("41/78");
    expect(whole.className).toContain("text-ink-45");
    expect(whole.getAttribute("title")).toBeNull();
    // A prefix that costs the year: no ellipsis, but shortened all the same.
    rerender(<WebhookPreview {...props} webhooks={{ ...props.webhooks, subjectPrefix: "[Media server alerts]" }} />);
    expect(screen.getByText("[Media server alerts] [Radarr] Grabbed: Dune: Part Three")).toBeTruthy();
    const counter = screen.getByText("56/78");
    expect(counter.className).toContain("text-status-warning");
    expect(counter.getAttribute("title")).toBe("The title was shortened to fit the subject");
    expect(screen.getByText("Radarr grabbed: Dune: Part Three (2026)")).toBeTruthy();
  });

  it("follows the admin's surface, and forces dark through the data-ogsc hook", async () => {
    const user = userEvent.setup();
    render(<WebhookPreview {...props} />);
    expect(screen.getByRole("button", { name: "Light" }).getAttribute("aria-pressed")).toBe("true");
    // The stylesheet always carries the [data-ogsc] rules; only Dark sets the
    // attribute on the root.
    expect(srcdoc()).not.toContain("<html data-ogsc");
    await user.click(screen.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(srcdoc()).toContain("<html data-ogsc "));
    expect(screen.getByTitle(/^Email preview: /).style.colorScheme).toBe("dark");
  });

  it("offers Send sample once per channel that takes inbound webhooks, named for it, held while saving", () => {
    const { rerender } = render(<WebhookPreview {...props} />);
    // Named per channel, so two of them never sound alike to a screen reader;
    // the visible label stays the name's prefix.
    const buttons = screen.getAllByRole("button", { name: "Send sample to Chat" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Send sample");
    expect(screen.getByText("Chat")).toBeTruthy();
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    rerender(<WebhookPreview {...props} saving />);
    expect((screen.getByRole("button", { name: /^Send sample/ }) as HTMLButtonElement).disabled).toBe(true);
    const two = alertsSchema.parse({
      channels: [
        { id: "a", type: "webhook", name: "Chat", url: "https://a.test" },
        { id: "b", type: "webhook", url: "https://b.test" },
      ],
    });
    rerender(<WebhookPreview {...props} alerts={two} />);
    expect(screen.getAllByRole("button", { name: /^Send sample/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Send sample to Chat",
      "Send sample to Webhook",
    ]);
    rerender(<WebhookPreview {...props} alerts={alertsSchema.parse({})} />);
    expect(screen.queryByRole("button", { name: /^Send sample/ })).toBeNull();
  });
});
