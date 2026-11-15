import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ArrDetail as ArrDetailData } from "@/lib/services/arr";
import ArrDetail from "./ArrDetail";

// Sonarr's and Radarr's page (#510) on the page kit (#508).
const HOUR = 3_600_000;
const now = Date.now();
const extras = {
  queue: [],
  queueTotal: 0,
  missing: [],
  missingTotal: 0,
  disks: [],
  links: { home: "http://sonarr.lan", queue: "http://sonarr.lan/activity/queue", missing: "http://sonarr.lan/wanted/missing" },
};
const data: ArrDetailData = {
  ...extras,
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
    render(<ArrDetail kind="sonarr" data={{ ...extras, upcoming: [], recent: [], health: [] }} />);
    expect(screen.getByText("Nothing scheduled in the next two weeks.")).toBeDefined();
    expect(screen.getByText("Nothing grabbed or imported lately.")).toBeDefined();
    expect(screen.getByText("Healthy")).toBeDefined();
    expect(screen.queryByRole("region", { name: "Health" })).toBeNull();
    // An empty queue takes no room; nothing missing says so.
    expect(screen.queryByRole("region", { name: /Downloading/ })).toBeNull();
    expect(screen.getByText("Nothing is missing.")).toBeDefined();
  });

  it("shows what's downloading, missing and the disks, each row opening in the service (#522, #523)", () => {
    render(
      <ArrDetail
        kind="sonarr"
        data={{
          ...data,
          queue: [
            {
              title: "Severance",
              subtitle: "S02E03",
              progress: 0.62,
              status: "downloading",
              timeLeft: "00:14:10",
              size: 2 * 1024 ** 3,
              poster: "https://art.example/severance.jpg",
              href: "http://sonarr.lan/series/severance",
            },
            { title: "Slow Horses", subtitle: "S04E02", progress: 1, status: "warning", timeLeft: null, size: null },
          ],
          queueTotal: 2,
          missing: [{ title: "Andor", subtitle: "S02E07", at: now - 48 * HOUR, href: "http://sonarr.lan/series/andor" }],
          missingTotal: 23,
          disks: [{ path: "/tv", free: 2 * 1024 ** 4, total: 20 * 1024 ** 4 }],
        }}
      />
    );
    const queue = screen.getByRole("region", { name: /Downloading/ });
    expect(within(queue).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "SeveranceS02E03 · 2.0 GB · 14m leftDownloading62%",
      // No artwork: the title's initial stands in for the poster.
      "SSlow HorsesS04E02Needs a look100%",
    ]);
    const link = within(queue).getByRole("link", { name: "Severance" });
    expect(link.getAttribute("href")).toBe("http://sonarr.lan/series/severance");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(queue.querySelector("img")?.getAttribute("src")).toBe("https://art.example/severance.jpg");
    // The stuck import shows in the headline tile.
    expect(screen.getByText("Downloading", { selector: "span.uppercase" }).closest("div")?.textContent).toBe("Downloading21 need a look");
    const missing = screen.getByRole("region", { name: /Missing/ });
    expect(within(missing).getByRole("link", { name: /See them all/ }).getAttribute("href")).toBe("http://sonarr.lan/wanted/missing");
    expect(within(screen.getByRole("region", { name: /Disk space/ })).getByRole("listitem").textContent).toBe("/tv2.0 TB free of 20 TB90% used");
  });
});
