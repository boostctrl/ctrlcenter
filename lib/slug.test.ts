import { describe, it, expect } from "vitest";
import { slugId } from "./slug";

describe("slugId", () => {
  it("makes a lower-case dashed id, numbering one that's taken", () => {
    expect(slugId("  Media & Downloads! ", [], "board")).toBe("media-downloads");
    expect(slugId("Media", ["media", "media-2"], "board")).toBe("media-3");
    expect(slugId("!!!", [], "board")).toBe("board");
  });

  // #483: the 56-character cut could end on the dash between two words.
  it("never ends an id in a dash where the length cut falls", () => {
    const name = `${"a".repeat(55)} b`;
    expect(slugId(name, [], "board")).toBe("a".repeat(55));
    expect(slugId(name, ["a".repeat(55)], "board")).toBe(`${"a".repeat(55)}-2`);
  });
});
