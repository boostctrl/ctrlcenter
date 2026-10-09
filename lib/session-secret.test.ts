import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { persistedSessionSecret } from "./session-secret";

// The persisted session-signing secret (#254, #289).
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-secret-"));
  vi.stubEnv("CONFIG_PATH", path.join(dir, "config.yaml"));
});

describe("persistedSessionSecret", () => {
  it("creates a random secret beside config.yaml, readable only by its owner", async () => {
    const secret = await persistedSessionSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url
    const file = path.join(dir, "session-secret");
    expect((await fs.readFile(file, "utf8")).trim()).toBe(secret);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it("returns the same secret on every call (one load per process)", async () => {
    const [a, b] = await Promise.all([persistedSessionSecret(), persistedSessionSecret()]);
    expect(a).toBe(b);
    expect(await persistedSessionSecret()).toBe(a);
  });

  it("reuses a secret already on disk (survives restarts)", async () => {
    await fs.writeFile(path.join(dir, "session-secret"), "kept-from-last-boot\n");
    expect(await persistedSessionSecret()).toBe("kept-from-last-boot");
  });

  it("returns null rather than throwing when the volume can't hold the file", async () => {
    const blocker = path.join(dir, "not-a-dir");
    await fs.writeFile(blocker, "");
    vi.stubEnv("CONFIG_PATH", path.join(blocker, "config.yaml"));
    expect(await persistedSessionSecret()).toBeNull();
  });
});
