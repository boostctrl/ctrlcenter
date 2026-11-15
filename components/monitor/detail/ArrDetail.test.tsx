import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ArrSnapshot } from "@/lib/services/arr";
import ArrDetail from "./ArrDetail";

// Sonarr's and Radarr's page (#510) on the page kit (#508).
const HOUR = 3_600_000;
const now = Date.now();
const data: ArrSnapshot = {
  upcoming: [{ title: "Severance", subtitle: "S02E07", at: now + 30 * HOUR }],
  recent: Array.from({ length: 12 }, (_, i) => ({
    title: `Show ${i + 1}`,
    subtitle: `S01E0${(i % 9) + 1}`,
    event: i % 2 ? "grabbed" : "imported",
    at: now - (i + 1) * HOUR,
  })),
  health: [
    { type: "notice", message: "Update available" },
    { type: "error", message: "All download clients are unavailable" },
    { type: "warning", message: "Indexer unavailable" },
  ],
};

describe("ArrDetail", () => {
  it("lists the health checks most severe first, with their kind", () => {
    render(<ArrDetail kind="sonarr" data={data} />);
    const health = screen.getByRole("region", { name: "Health" });
    const rows = within(health).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual([
      "All download clients are unavailableError",
      "Indexer unavailableWarning",
      "Update availableNotice",
    ]);
  });

  it("leads with the errors when there are any", () => {
    render(<ArrDetail kind="sonarr" data={data} />);
    const tile = screen.getByText("Health", { selector: "span" }).closest("div");
    expect(tile?.textContent).toBe("Health1error1 warning");
  });

  it("shows the first eight recent rows, and the rest on request", () => {
    render(<ArrDetail kind="radarr" data={data} />);
    const recent = screen.getByRole("region", { name: /Recent activity/ });
    expect(within(recent).getAllByRole("listitem")).toHaveLength(8);
    fireEvent.click(within(recent).getByRole("button", { name: "Show all 12" }));
    expect(within(recent).getAllByRole("listitem")).toHaveLength(12);
    expect(within(recent).getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("says so when nothing is coming up or has happened lately", () => {
    render(<ArrDetail kind="sonarr" data={{ upcoming: [], recent: [], health: [] }} />);
    expect(screen.getByText("Nothing scheduled in the next two weeks.")).toBeDefined();
    expect(screen.getByText("Nothing grabbed or imported lately.")).toBeDefined();
    expect(screen.getByText("Healthy")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Health" })).toBeNull();
  });
});
