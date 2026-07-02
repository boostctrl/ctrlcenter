import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

// uploads.ts derives its dir from CONFIG_DIR (config.ts), which captures
// CONFIG_PATH at module load — so set it before the dynamic import.
let uploads: typeof import("./uploads");
let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-uploads-"));
  process.env.CONFIG_PATH = path.join(dir, "config.yaml");
  uploads = await import("./uploads");
});

describe("isSafeName", () => {
  it("accepts plain single-segment names", () => {
    expect(uploads.isSafeName("logo-1a2b.png")).toBe(true);
    expect(uploads.isSafeName("My_Icon.SVG")).toBe(true);
  });

  it("rejects path separators and traversal", () => {
    for (const bad of ["../secret", "a/b.png", "..", "a\\b.png", "/etc/passwd", ".."]) {
      expect(uploads.isSafeName(bad)).toBe(false);
    }
  });
});

describe("extForType", () => {
  it("maps allowed image types to an extension", () => {
    expect(uploads.extForType("image/png")).toBe("png");
    expect(uploads.extForType("image/svg+xml")).toBe("svg");
    expect(uploads.extForType("image/jpeg")).toBe("jpg");
  });

  it("returns null for disallowed types", () => {
    expect(uploads.extForType("application/octet-stream")).toBeNull();
    expect(uploads.extForType("text/html")).toBeNull();
  });
});

describe("save / list / read / delete round-trip", () => {
  it("stores an upload under an app-generated name and reads it back", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { name, url } = await uploads.saveIcon("My Logo.png", "image/png", bytes);

    // Name is app-generated: slugified base + random suffix + validated ext.
    expect(name).toMatch(/^my-logo-[0-9a-f]{8}\.png$/);
    expect(url).toBe(`/api/icons/${name}`);

    const listed = await uploads.listIcons();
    expect(listed.map((i) => i.name)).toContain(name);

    const read = await uploads.readIcon(name);
    expect(read?.type).toBe("image/png");
    expect(new Uint8Array(read!.data)).toEqual(bytes);

    expect(await uploads.deleteIcon(name)).toBe(true);
    expect(await uploads.readIcon(name)).toBeNull();
  });

  it("derives the extension from the content type, not the filename", async () => {
    const { name } = await uploads.saveIcon("evil.php", "image/png", new Uint8Array([0]));
    expect(name.endsWith(".png")).toBe(true);
    await uploads.deleteIcon(name);
  });

  it("refuses to read outside the uploads dir", async () => {
    expect(await uploads.readIcon("../config.yaml")).toBeNull();
    expect(await uploads.readIcon("../../etc/passwd")).toBeNull();
  });
});

describe("backup bundling (sanitizeBundledIcons)", () => {
  const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");

  it("treats an absent field as no icons (pre-bundling backups)", () => {
    expect(uploads.sanitizeBundledIcons(undefined)).toEqual([]);
    expect(uploads.sanitizeBundledIcons(null)).toEqual([]);
  });

  it("decodes valid entries", () => {
    const out = uploads.sanitizeBundledIcons([
      { name: "logo-1a2b.png", data: b64([1, 2, 3]) },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0].name).toBe("logo-1a2b.png");
    expect(Array.from(out![0].bytes)).toEqual([1, 2, 3]);
  });

  it("rejects the whole bundle on any bad entry", () => {
    const ok = { name: "logo.png", data: b64([1]) };
    // Traversal / multi-segment names.
    expect(
      uploads.sanitizeBundledIcons([ok, { name: "../evil.png", data: b64([1]) }])
    ).toBeNull();
    // Extensions that wouldn't be served as an image.
    expect(
      uploads.sanitizeBundledIcons([{ name: "evil.html", data: b64([1]) }])
    ).toBeNull();
    // Empty or missing payloads.
    expect(uploads.sanitizeBundledIcons([{ name: "a.png", data: "" }])).toBeNull();
    expect(uploads.sanitizeBundledIcons([{ name: "a.png" }])).toBeNull();
    // Non-array shapes.
    expect(uploads.sanitizeBundledIcons({ name: "a.png" })).toBeNull();
    expect(uploads.sanitizeBundledIcons("nope")).toBeNull();
  });

  it("rejects oversize payloads and oversize bundles", () => {
    const big = "A".repeat(Math.ceil((uploads.MAX_ICON_BYTES * 4) / 3) + 8);
    expect(
      uploads.sanitizeBundledIcons([{ name: "big.png", data: big }])
    ).toBeNull();
    const many = Array.from({ length: uploads.MAX_BUNDLED_ICONS + 1 }, (_, i) => ({
      name: `i${i}.png`,
      data: b64([1]),
    }));
    expect(uploads.sanitizeBundledIcons(many)).toBeNull();
  });
});

describe("backup bundling (export → wipe → restore round-trip)", () => {
  it("re-materializes exported icons under their original names", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    const { name } = await uploads.saveIcon("Round Trip.png", "image/png", bytes);

    const bundle = await uploads.exportIcons();
    const entry = bundle.find((e) => e.name === name);
    expect(entry).toBeDefined();

    // Simulate a fresh instance: the file is gone, only the backup remains.
    expect(await uploads.deleteIcon(name)).toBe(true);
    expect(await uploads.readIcon(name)).toBeNull();

    const sanitized = uploads.sanitizeBundledIcons([entry]);
    expect(sanitized).toHaveLength(1);
    await uploads.writeBundledIcons(sanitized!);

    const restored = await uploads.readIcon(name);
    expect(restored?.type).toBe("image/png");
    expect(new Uint8Array(restored!.data)).toEqual(bytes);
    await uploads.deleteIcon(name);
  });
});
