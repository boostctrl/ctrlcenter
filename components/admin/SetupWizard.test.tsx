import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configSchema } from "@/lib/schema";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: SetupWizard } = await import("./SetupWizard");

const settings = configSchema.parse({}).settings;

describe("SetupWizard", () => {
  afterEach(() => vi.unstubAllGlobals());

  // #464: a retry after one add failed added the earlier apps again.
  it("retries the Apps step without adding the earlier apps twice", async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    let failThird = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/apps" && init?.method === "POST") {
          const app = JSON.parse(String(init.body)) as { url: string };
          posted.push(app.url);
          if (app.url === "https://c.example.com" && failThird) {
            failThird = false;
            return new Response("{}", { status: 500 });
          }
          return Response.json({ id: String(posted.length), ...app });
        }
        return Response.json({});
      })
    );
    render(<SetupWizard settings={settings} packs={[]} twoFactorEnabled={false} />);
    await user.click(screen.getByRole("button", { name: "Skip this step" }));
    await user.type(
      screen.getByLabelText(/^Paste your apps' addresses/),
      "https://a.example.com\nhttps://b.example.com\nhttps://c.example.com"
    );
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't add/);
    await user.click(screen.getByRole("button", { name: "Save and continue" }));
    await screen.findByText("Step 3 of 5");
    expect(posted).toEqual([
      "https://a.example.com",
      "https://b.example.com",
      "https://c.example.com",
      "https://c.example.com",
    ]);
  });
});
