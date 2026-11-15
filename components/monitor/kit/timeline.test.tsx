import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LineChart } from "./timeline";

// The line chart of recorded readings (#530).
const at = [0, 60_000, 120_000, 180_000];
const fmt = (v: number) => `${v} MB/s`;

describe("LineChart", () => {
  it("waits for two readings before drawing", () => {
    render(<LineChart label="Speed" at={at} format={fmt} series={[{ label: "Download", color: 1, values: [null, null, null, 4] }]} />);
    expect(screen.getByText(/Collecting readings/)).toBeDefined();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("says what it shows, and answers the arrow keys with each series at that moment", () => {
    render(
      <LineChart
        label="Speed"
        at={at}
        format={fmt}
        series={[
          { label: "Download", color: 1, values: [2, 8, null, 4] },
          { label: "Upload", color: 3, values: [1, 1, null, 2] },
        ]}
      />
    );
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toBe("Speed: Download now 4 MB/s, peak 8 MB/s; Upload now 2 MB/s, peak 2 MB/s");
    // From the newest reading back one: the gap reads as no reading.
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByRole("status").textContent).toMatch(/Download–Upload–$/);
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByRole("status").textContent).toMatch(/Download2 MB\/sUpload1 MB\/s$/);
    // The legend names each series with its latest reading.
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Download4 MB/s", "Upload2 MB/s"]);
  });
});
