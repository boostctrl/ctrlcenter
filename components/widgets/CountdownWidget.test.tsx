import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../PrefsProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../PrefsProvider")>()),
  useLocalePrefs: () => ({ timezone: "UTC", name: "" }),
}));

const { default: CountdownWidget, isValidCountdownDate } = await import("./CountdownWidget");

// A date shaped like YYYY-MM-DD that doesn't exist used to reach the date
// formatter, which threw RangeError and took the whole board to the error page
// (#390). Such a row is skipped instead.
describe("CountdownWidget with an impossible date (#390)", () => {
  it("skips the row and still shows the real ones", () => {
    render(
      <CountdownWidget
        title="Dates"
        items={[
          { label: "Month 13", date: "2026-13-01" },
          { label: "Dec 32", date: "2026-12-32" },
          { label: "Launch", date: "2099-01-01" },
        ]}
      />
    );
    screen.getByText("Launch");
    expect(screen.queryByText("Month 13")).toBeNull();
    expect(screen.queryByText("Dec 32")).toBeNull();
  });

  it("renders nothing when no row has a real date", () => {
    const { container } = render(<CountdownWidget title="Dates" items={[{ label: "Nope", date: "2026-02-30" }]} />);
    expect(container.innerHTML).toBe("");
    expect(isValidCountdownDate("2026-02-30")).toBe(false);
  });
});
