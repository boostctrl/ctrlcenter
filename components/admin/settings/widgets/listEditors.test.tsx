import { useState, type ComponentType } from "react";
import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { newInstance, type InstanceOf } from "@/lib/schema";
import type { WidgetType } from "@/lib/layout";
import { applyInstancePatch } from "../instancePatch";
import type { InstanceEditorProps } from "./index";
import WorldClocksSettings from "./WorldClocksSettings";
import CountdownSettings from "./CountdownSettings";
import SystemStatsSettings from "./SystemStatsSettings";
import FeedSettings from "./FeedSettings";
import ApiSettings from "./ApiSettings";

// #163: the instance list editors handed onChange a list computed from the
// instance as rendered, so "+ Add" clicked again before a repaint (several
// clicks batched in one tick) started from the same list each time and only
// the last row survived. Each editor now passes an updater, applied to the
// latest instance the way Settings → Widgets and the in-place panel do.

vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));

function Harness<T extends WidgetType>({
  Editor,
  initial,
}: {
  Editor: ComponentType<InstanceEditorProps<T>>;
  initial: InstanceOf<T>;
}) {
  const [w, setW] = useState(initial);
  return (
    <Editor
      w={w}
      label="Card"
      onChange={(p) => setW((prev) => applyInstancePatch(prev, p))}
      groups={[]}
      tags={[]}
      integrations={[]}
    />
  );
}

const cases = [
  ["world clocks", WorldClocksSettings, newInstance("worldClocks", "w1"), "+ Add time zone", /^Remove Card clock/],
  ["countdown dates", CountdownSettings, newInstance("countdown", "c1"), "+ Add date", /^Remove Card date/],
  ["system stats disks", SystemStatsSettings, newInstance("systemStats", "s1"), "+ Add disk", /^Remove Card disk/],
  ["feed URLs", FeedSettings, newInstance("feed", "f1"), "+ Add feed", /^Remove Card feed/],
  ["API headers", ApiSettings, newInstance("api", "a1"), "+ Add header", /^Remove header/],
  ["API rows", ApiSettings, { ...newInstance("api", "a2"), display: "kv" as const }, "+ Add row", /^Remove field/],
] as const;

describe("list editors keep every row of a quick run of adds (#163)", () => {
  it.each(cases)("%s", (_, Editor, initial, add, row) => {
    render(<Harness Editor={Editor as ComponentType<InstanceEditorProps<WidgetType>>} initial={initial} />);
    const before = screen.queryAllByRole("button", { name: row }).length;
    const button = screen.getByRole("button", { name: add });
    act(() => {
      button.click();
      button.click();
      button.click();
    });
    // The API's lone first field shows no Remove, so its rows count from 1.
    const rows = add === "+ Add row" ? Math.max(before, 1) : before;
    expect(screen.queryAllByRole("button", { name: row })).toHaveLength(rows + 3);
  });
});
