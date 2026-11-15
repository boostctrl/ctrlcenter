import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BarChart, Donut } from "./charts";

// The larger charts (stage E): each names its parts in words, in a legend
// and for a screen reader, so color is never the only cue.
describe("Donut", () => {
  it("names every part with its figure and share, and draws only the ones with something in them", () => {
    const { container } = render(
      <Donut
        label="The library's movies"
        center="4"
        caption="movies"
        parts={[
          { label: "Downloaded", value: 3, color: 3 },
          { label: "Missing", value: 1, color: 2 },
          { label: "Not out yet", value: 0, color: 1 },
        ]}
      />
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "The library's movies: Downloaded 3, Missing 1, Not out yet 0"
    );
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Downloaded375%", "Missing125%", "Not out yet00%"]);
    // The track, and an arc for each of the two parts that have any.
    expect(container.querySelectorAll("circle")).toHaveLength(3);
  });
});

describe("BarChart", () => {
  it("sums each series for the legend and the screen reader, and labels each column", () => {
    render(
      <BarChart
        label="This week"
        series={[
          { label: "Imported", color: 3 },
          { label: "Grabbed", color: 1 },
        ]}
        slots={[
          { label: "Sat", values: [2, 1] },
          { label: "Today", values: [0, 4] },
        ]}
      />
    );
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toBe("This week: 2 Imported, 5 Grabbed");
    expect(within(chart).getByTitle("Today: 0 Imported, 4 Grabbed")).toBeDefined();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Imported2", "Grabbed5"]);
  });
});
