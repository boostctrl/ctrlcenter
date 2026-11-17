import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  alertStateSaved,
  loadAlertState,
  MAX_BOOK_ENTRIES,
  readBook,
  resetAlertState,
  writeBook,
} from "./alert-state";

// The alert state that outlasts a restart (#559): one book per source of
// alerts, in alert-state.json beside the config.
vi.mock("./log", () => ({ log: { warn: vi.fn(), info: vi.fn() }, errorReason: (e: unknown) => String(e) }));

type Entry = { lastSent: number };
const isEntry = (v: unknown): v is Entry =>
  !!v && typeof v === "object" && typeof (v as Entry).lastSent === "number";

let dir: string;
const file = () => path.join(dir, "alert-state.json");
const onDisk = () => JSON.parse(fs.readFileSync(file(), "utf8"));
// A new process: memory gone, the file kept.
const restart = async () => {
  await alertStateSaved();
  resetAlertState();
  await loadAlertState();
};

beforeEach(async () => {
  resetAlertState();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctrl-alert-state-"));
  vi.stubEnv("CONFIG_PATH", path.join(dir, "config.yaml"));
  const { log } = await import("./log");
  vi.mocked(log.warn).mockClear();
});
afterEach(async () => {
  await alertStateSaved();
  resetAlertState();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("alert state", () => {
  it("starts empty without a file, and writes none for an empty book", async () => {
    await loadAlertState();
    expect(readBook("warnings", isEntry).size).toBe(0);
    writeBook("warnings", new Map());
    await alertStateSaved();
    expect(fs.existsSync(file())).toBe(false);
  });

  it("saves a book privately and reads it back after a restart", async () => {
    await loadAlertState();
    writeBook("warnings", new Map([["plex", { lastSent: 1 }]]));
    await alertStateSaved();
    expect(onDisk()).toEqual({ version: 1, books: { warnings: { plex: { lastSent: 1 } } } });
    if (process.platform !== "win32") expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    await restart();
    expect(Object.fromEntries(readBook("warnings", isEntry))).toEqual({ plex: { lastSent: 1 } });
  });

  it("writes only when a book changes, and removes the file once every book is empty", async () => {
    await loadAlertState();
    writeBook("warnings", new Map([["plex", { lastSent: 1 }]]));
    await alertStateSaved();
    // An unchanged book is no reason to write: the file isn't put back.
    fs.rmSync(file());
    writeBook("warnings", new Map([["plex", { lastSent: 1 }]]));
    await alertStateSaved();
    expect(fs.existsSync(file())).toBe(false);
    writeBook("warnings", new Map([["plex", { lastSent: 2 }]]));
    await alertStateSaved();
    expect(onDisk().books.warnings.plex).toEqual({ lastSent: 2 });
    writeBook("warnings", new Map());
    await alertStateSaved();
    expect(fs.existsSync(file())).toBe(false);
  });

  it("hands a source only the entries it accepts", async () => {
    fs.writeFileSync(
      file(),
      JSON.stringify({ version: 1, books: { warnings: { plex: { lastSent: 1 }, bad: { lastSent: "soon" }, worse: 3 } } })
    );
    await loadAlertState();
    expect([...readBook("warnings", isEntry).keys()]).toEqual(["plex"]);
  });

  it("carries a book it doesn't know along as it was read", async () => {
    fs.writeFileSync(
      file(),
      JSON.stringify({ version: 1, books: { warnings: {}, later: { x: { level: "warn" } } } })
    );
    await loadAlertState();
    writeBook("warnings", new Map([["plex", { lastSent: 1 }]]));
    await alertStateSaved();
    expect(onDisk().books).toEqual({ warnings: { plex: { lastSent: 1 } }, later: { x: { level: "warn" } } });
  });

  it("starts afresh from a file it can't read, says so, and replaces it on the next write", async () => {
    const { log } = await import("./log");
    for (const text of ["{not json", JSON.stringify({ version: 2, books: {} }), JSON.stringify([1])]) {
      resetAlertState();
      fs.writeFileSync(file(), text);
      await loadAlertState();
      expect(readBook("warnings", isEntry).size).toBe(0);
    }
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(3);
    writeBook("warnings", new Map([["plex", { lastSent: 1 }]]));
    await alertStateSaved();
    expect(onDisk().version).toBe(1);
  });

  it("caps a book's entries", async () => {
    await loadAlertState();
    const many = new Map(Array.from({ length: MAX_BOOK_ENTRIES + 5 }, (_, i) => [`app-${i}`, { lastSent: i }] as const));
    writeBook("warnings", many);
    await restart();
    expect(readBook("warnings", isEntry).size).toBe(MAX_BOOK_ENTRIES);
  });
});
