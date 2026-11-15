import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Complication from "./Complication";

// A Monitor tile, as a screen reader meets it (#518): the service's name
// before its numbers, and a stale read said in words, not only by the
// dot's color.
const tile = (state: "live" | "stale") =>
  render(<Complication label="Sonarr" state={state} href="/admin/monitor/sonarr" center="14" caption="this week" lines={["Severance"]} />);

describe("Complication", () => {
  it("reads the service's name first", () => {
    tile("live");
    const link = screen.getByRole("link");
    expect(link.textContent).toBe("SonarrSeverance14this week");
  });

  it("says when it's showing stale data", () => {
    tile("stale");
    expect(screen.getByRole("link").textContent).toBe("Sonarr· StaleSeverance14this week");
  });
});
