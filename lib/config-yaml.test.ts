import { describe, it, expect } from "vitest";
import { updateYamlText } from "./config-yaml";
import { parseConfigYaml } from "./config";

// Comment-preserving config writes (#279).
const update = (raw: string, value: unknown) => updateYamlText(raw, value, parseConfigYaml);

describe("updateYamlText", () => {
  it("keeps comments, order and quoting when a value changes", () => {
    const raw = [
      "# My homelab dashboard",
      "settings:",
      '  title: "Home" # shown in the tab',
      "  # how often to check apps",
      "  statusInterval: 5",
      "apps: []",
      "",
    ].join("\n");
    const out = update(raw, { settings: { title: "Lab", statusInterval: 5 }, apps: [] });
    expect(out).toBe(
      [
        "# My homelab dashboard",
        "settings:",
        '  title: "Lab" # shown in the tab',
        "  # how often to check apps",
        "  statusInterval: 5",
        "apps: []",
        "",
      ].join("\n")
    );
  });

  it("keeps each list item's comments with it through a reorder and a delete", () => {
    const raw = [
      "apps:",
      "  # the media server",
      "  - id: plex",
      "    name: Plex",
      "  # NAS — do not remove",
      "  - id: nas",
      "    name: NAS",
      "  - id: old",
      "    name: Old",
      "",
    ].join("\n");
    const out = update(raw, {
      apps: [
        { id: "nas", name: "NAS" },
        { id: "plex", name: "Plex" },
      ],
    })!;
    expect(out).not.toContain("Old");
    expect(out.indexOf("# NAS — do not remove")).toBeLessThan(out.indexOf("id: nas"));
    expect(out.indexOf("id: nas")).toBeLessThan(out.indexOf("# the media server"));
    expect(out.indexOf("# the media server")).toBeLessThan(out.indexOf("id: plex"));
  });

  it("adds new keys and items as block YAML, and drops removed keys", () => {
    const raw = "# top\nsettings:\n  title: Home\n  legacy: true\napps: []\n";
    const out = update(raw, {
      settings: { title: "Home", search: { enabled: true } },
      apps: [{ id: "a", name: "A" }],
    })!;
    expect(out).toContain("# top");
    expect(out).not.toContain("legacy");
    expect(out).toContain("  search:\n    enabled: true");
    expect(out).toContain("apps:\n  - id: a\n    name: A");
  });

  it("given the previous config, leaves untouched defaults implicit", () => {
    const raw = "# minimal\nsettings:\n  title: Home\n";
    const prev = {
      settings: { title: "Home", search: { engine: "ddg", bangs: [] }, statusInterval: 5 },
      apps: [],
    };
    const value = {
      settings: { title: "Home", search: { engine: "google", bangs: [] }, statusInterval: 5 },
      apps: [],
    };
    // Only the changed leaf is written; its unchanged siblings stay implicit.
    expect(updateYamlText(raw, value, () => value, prev)).toBe(
      "# minimal\nsettings:\n  title: Home\n  search:\n    engine: google\n"
    );
  });

  it("doesn't fold long strings", () => {
    const url = `https://example.com/${"x".repeat(200)}`;
    expect(update("url: a\n", { url })).toBe(`url: ${url}\n`);
  });

  it("declines files with anchors, aliases or merge keys", () => {
    const raw = "base: &b\n  a: 1\nother:\n  <<: *b\n  c: 2\n";
    expect(update(raw, { base: { a: 1 }, other: { a: 1, c: 3 } })).toBeNull();
  });

  it("declines a file that doesn't parse", () => {
    expect(update("a: [1, 2\n", { a: [1, 2] })).toBeNull();
  });

  it("declines when the result wouldn't read back as the intended config", () => {
    expect(updateYamlText("a: 1\n", { a: 2 }, () => ({ a: 1 }))).toBeNull();
  });

  it("writes into an empty or comment-only file", () => {
    expect(update("# nothing yet\n", { a: 1 })).toBe("# nothing yet\n\na: 1\n");
    expect(update("", { a: 1 })).toBe("a: 1\n");
  });
});
