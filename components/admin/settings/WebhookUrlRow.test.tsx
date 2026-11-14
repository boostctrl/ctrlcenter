import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SECRET_PLACEHOLDER } from "@/lib/schema";
import { ToastProvider } from "../Toast";
import { WebhookUrlRow } from "./WebhookUrlRow";

function setup(response: Response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  render(
    <ToastProvider>
      <WebhookUrlRow service="sonarr" label="Sonarr" token={SECRET_PLACEHOLDER} onRegenerate={() => {}} />
    </ToastProvider>
  );
  return userEvent.setup();
}

describe("WebhookUrlRow reveal", () => {
  afterEach(() => vi.unstubAllGlobals());

  // #487: the Response itself went to apiErrorMessage, which reads a parsed
  // body, so the server's reason never showed.
  it("shows the server's reason when the reveal fails", async () => {
    const user = setup(
      new Response(JSON.stringify({ error: "Too many attempts. Try again in a minute." }), {
        status: 429,
      })
    );
    await user.click(screen.getByRole("button", { name: "Reveal" }));
    expect(await screen.findByText("Too many attempts. Try again in a minute.")).toBeTruthy();
  });

  it("falls back to a general message for a body that isn't JSON", async () => {
    const user = setup(new Response("Bad gateway", { status: 502 }));
    await user.click(screen.getByRole("button", { name: "Reveal" }));
    expect(await screen.findByText("Couldn't reveal the token")).toBeTruthy();
  });

  it("puts the revealed token in the URL", async () => {
    const user = setup(new Response(JSON.stringify({ token: "tok-abc" }), { status: 200 }));
    await user.click(screen.getByRole("button", { name: "Reveal" }));
    expect(
      ((await screen.findByDisplayValue(/token=tok-abc$/)) as HTMLInputElement).value
    ).toMatch(/\/api\/hooks\/sonarr\?token=tok-abc$/);
  });
});
