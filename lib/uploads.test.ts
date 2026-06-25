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
