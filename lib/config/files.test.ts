import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { writeFileAtomic, writeFileOnce } from "./files";

// The writers behind config.yaml, its .bak and the 2.x backup (#386).
let dir: string;
const mode = async (file: string) => (await fs.stat(file)).mode & 0o777;
const leftovers = async () => (await fs.readdir(dir)).filter((f) => f.endsWith(".tmp"));

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-files-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

// A temp file an older version's crash left behind: world-readable.
async function staleTemp(dest: string) {
  await fs.writeFile(`${dest}.tmp`, "torn", "utf8");
  await fs.chmod(`${dest}.tmp`, 0o644);
}

describe("writeFileAtomic", () => {
  it("replaces the file 0600, even over a 0644 file and a stale 0644 temp file", async () => {
    const dest = path.join(dir, "config.yaml");
    await fs.writeFile(dest, "old", "utf8");
    await fs.chmod(dest, 0o644);
    await staleTemp(dest);
    await writeFileAtomic(dest, "new");
    expect(await fs.readFile(dest, "utf8")).toBe("new");
    expect(await mode(dest)).toBe(0o600);
    expect(await leftovers()).toEqual([]);
  });

  it("leaves no temp file when the rename fails", async () => {
    const dest = path.join(dir, "taken");
    await fs.mkdir(path.join(dest, "inside"), { recursive: true });
    await expect(writeFileAtomic(dest, "text")).rejects.toThrow();
    expect(await leftovers()).toEqual([]);
  });
});

describe("writeFileOnce", () => {
  it("writes a new file 0600 past a stale temp file, and leaves no temp file", async () => {
    const dest = path.join(dir, "config.v2.bak.yaml");
    await staleTemp(dest);
    expect(await writeFileOnce(dest, "v2")).toBe(true);
    expect(await fs.readFile(dest, "utf8")).toBe("v2");
    expect(await mode(dest)).toBe(0o600);
    expect(await leftovers()).toEqual([]);
  });

  it("never replaces an existing file", async () => {
    const dest = path.join(dir, "config.v2.bak.yaml");
    await fs.writeFile(dest, "the first copy", "utf8");
    expect(await writeFileOnce(dest, "v2")).toBe(false);
    expect(await fs.readFile(dest, "utf8")).toBe("the first copy");
    expect(await leftovers()).toEqual([]);
  });

  it("links into place, so a file that appears meanwhile isn't replaced either", async () => {
    const dest = path.join(dir, "config.v2.bak.yaml");
    const link = fs.link.bind(fs);
    // Someone takes the name between the temp file's write and the link: a
    // rename would overwrite theirs; link fails with EEXIST instead.
    vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      await fs.writeFile(to, "someone else's", "utf8");
      return link(from, to);
    });
    expect(await writeFileOnce(dest, "v2")).toBe(false);
    expect(await fs.readFile(dest, "utf8")).toBe("someone else's");
    expect(await leftovers()).toEqual([]);
  });

  it("creates the file itself where hard links aren't supported, still never replacing one", async () => {
    const dest = path.join(dir, "config.v2.bak.yaml");
    vi.spyOn(fs, "link").mockRejectedValue(Object.assign(new Error("no links"), { code: "EPERM" }));
    expect(await writeFileOnce(dest, "v2")).toBe(true);
    expect(await fs.readFile(dest, "utf8")).toBe("v2");
    expect(await mode(dest)).toBe(0o600);
    expect(await writeFileOnce(dest, "other")).toBe(false);
    expect(await fs.readFile(dest, "utf8")).toBe("v2");
    expect(await leftovers()).toEqual([]);
  });
});
