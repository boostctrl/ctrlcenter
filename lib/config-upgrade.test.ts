import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import * as YAML from "js-yaml";
import { migrateConfig } from "./config-migrate";
import { CONFIG_SCHEMA_VERSION, configSchema } from "./schema";

// The whole 2.x → 3.0 upgrade (#306) against configs as users of 2.0, 2.5,
// 2.10 and 2.13 would have them (lib/__fixtures__, each checked against its
// own release's schema when it was written). What a fixture holds is read
// from the fixture itself, so the checks hold however it's extended.
const FIXTURES = ["2.0", "2.5", "2.10", "2.13"];
const fixturePath = (v: string) => path.join(__dirname, "__fixtures__", `config-${v}.yaml`);

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Raw) : {});
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(rec) : []);

describe.each(FIXTURES)("upgrading a %s config", (version) => {
  let text: string;
  let before: Raw;
  let after: ReturnType<typeof configSchema.parse>;

  beforeAll(async () => {
    text = await fs.readFile(fixturePath(version), "utf8");
    before = rec(YAML.load(text));
    const migrated = migrateConfig(before);
    expect(migrated.changed).toBe(true);
    // Strict: what the upgrade saves must be a valid 3.0 config outright.
    after = configSchema.parse(migrated.value);
  });

  it("lands on the current schema, with a home board and nothing left in 2.x keys", () => {
    expect(after.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(after.boards.length).toBeGreaterThanOrEqual(1);
    const settings = rec(after.settings);
    for (const key of ["notes", "countdown", "worldClocks", "systemStats", "calendar", "feeds", "feed", "integrations", "components"])
      expect(settings, key).not.toHaveProperty(key);
    expect(rec(settings.layout)).not.toHaveProperty("sections");
  });

  it("keeps every app and bookmark, each bookmark in the group its category became", () => {
    const apps = list(before.apps);
    const bookmarks = list(before.bookmarks);
    expect(after.apps.map((a) => a.id)).toEqual(apps.map((a) => a.id));
    expect(after.bookmarks.map((b) => b.id)).toEqual(bookmarks.map((b) => b.id));
    const groupName = new Map(after.groups.map((g) => [g.id, g.name]));
    bookmarks.forEach((b, i) => {
      if (typeof b.category === "string" && b.category.trim())
        expect(groupName.get(after.bookmarks[i].group), String(b.name)).toBe(b.category.trim());
    });
  });

  it("carries each widget's content into an instance", () => {
    const settings = rec(before.settings);
    const ofType = (type: string) => after.widgets.filter((w) => w.type === type);
    const notes = rec(settings.notes);
    if (typeof notes.content === "string" && notes.content)
      expect(ofType("notes").map((w) => (w as { content: string }).content)).toContain(notes.content);
    const calendar = rec(settings.calendar);
    if (typeof calendar.url === "string" && calendar.url)
      expect(ofType("calendar")).toEqual(
        expect.arrayContaining([expect.objectContaining({ url: calendar.url })])
      );
    const countdown = list(rec(settings.countdown).items ?? rec(settings.countdown).dates);
    if (countdown.length) expect(ofType("countdown").length).toBeGreaterThan(0);
    const feedUrls = [
      ...list(settings.feeds).flatMap((f) => (Array.isArray(f.urls) ? f.urls : [f.url])),
      ...(typeof rec(settings.feed).url === "string" ? [rec(settings.feed).url] : []),
      ...(Array.isArray(rec(settings.feed).urls) ? (rec(settings.feed).urls as unknown[]) : []),
    ].filter((u): u is string => typeof u === "string" && u.trim() !== "");
    const migratedUrls = ofType("feed").flatMap((w) => (w as { urls: string[] }).urls);
    for (const url of feedUrls) expect(migratedUrls).toContain(url);
  });

  it("keeps each integration that was set up, with its address and key", () => {
    const old = rec(rec(before.settings).integrations);
    for (const [service, v] of Object.entries(old)) {
      const cfg = rec(v);
      const setUp = cfg.enabled === true || (typeof cfg.url === "string" && cfg.url.trim() !== "");
      if (!setUp) continue;
      const kept = after.integrations.find((i) => i.id === service);
      expect(kept, service).toBeDefined();
      expect(kept!.url).toBe(cfg.url ?? "");
      // Off unless it was switched on: 2.x read a missing switch as off.
      expect(kept!.enabled, service).toBe(cfg.enabled === true);
      if (typeof cfg.apiKey === "string") expect(kept!.apiKey).toBe(cfg.apiKey);
    }
  });

  it("shows what the 2.x home page showed", () => {
    const rows = list(rec(rec(before.settings).layout).sections);
    const home = after.boards[0].layout.sections;
    const byId = new Map(after.widgets.map((w) => [w.id, w]));
    // Every row names a widget that exists.
    for (const row of home) expect(byId.has(row.widget), row.widget).toBe(true);
    // A row shown in 2.x is shown in 3.0 (feed rows by instance, the rest by type).
    for (const row of rows) {
      if (row.hidden === true || typeof row.id !== "string") continue;
      const shown = home.some((r) => !r.hidden && (r.widget === row.id || byId.get(r.widget)?.type === row.id));
      expect(shown, `row ${row.id}`).toBe(true);
    }
  });

  it("leaves no 2.x on/off switch on the feed and calendar widgets", () => {
    const migrated = migrateConfig(before).value as Raw;
    for (const w of list(migrated.widgets))
      if (w.type === "feed" || w.type === "calendar") expect(w, String(w.id)).not.toHaveProperty("enabled");
  });

  it("is done once: a second pass changes nothing", () => {
    expect(migrateConfig(after).changed).toBe(false);
  });
});

// The settings the upgrade moves to a new place (#306). A comment on one of
// them doesn't follow it — the writer keeps comments by where a key sits, and
// these keys go away — so it lives on in config.v2.bak.yaml only.
const MOVED = new Set(["feeds", "feed", "notes", "countdown", "worldClocks", "systemStats", "calendar", "integrations", "components", "sections"]);

// The full-line comments of a YAML text, but for those on (or inside) a moved
// key: each comment belongs to the next key line, at that line's path.
function commentsOnStayingKeys(text: string): string[] {
  const lines = text.split("\n");
  const keep: string[] = [];
  const stack: { indent: number; key: string }[] = [];
  const keyLine = /^(\s*)(?:- )?([A-Za-z0-9_]+):/;
  for (let i = 0; i < lines.length; i++) {
    const m = keyLine.exec(lines[i]);
    if (m) {
      const indent = m[1].length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      stack.push({ indent, key: m[2] });
      continue;
    }
    if (!/^\s*#/.test(lines[i])) continue;
    // The path of the next key line, given the stack as it stands.
    const next = lines.slice(i + 1).find((l) => keyLine.test(l));
    const path = [...stack];
    if (next) {
      const n = keyLine.exec(next)!;
      while (path.length && path[path.length - 1].indent >= n[1].length) path.pop();
      path.push({ indent: n[1].length, key: n[2] });
    }
    if (!path.some((p) => MOVED.has(p.key))) keep.push(lines[i].trim());
  }
  return keep;
}

// Through the store, as on a real first start: the comments survive the save.
describe("upgrading through the store", () => {
  let configPath: string;
  let config: typeof import("./config");

  beforeAll(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-upgrade-"));
    configPath = path.join(dir, "config.yaml");
    process.env.CONFIG_PATH = configPath;
    config = await import("./config");
  });
  beforeEach(async () => {
    for (const f of ["config.v2.bak.yaml", "upgrade-notice.json", "config.yaml.bak"])
      await fs.rm(path.join(path.dirname(configPath), f), { force: true });
  });

  it.each(FIXTURES)("keeps the %s file's comments on what stays, and its backup verbatim", async (version) => {
    const text = await fs.readFile(fixturePath(version), "utf8");
    await fs.writeFile(configPath, text, "utf8");
    await config.readConfigInternal();
    const saved = await fs.readFile(configPath, "utf8");
    const comments = commentsOnStayingKeys(text);
    expect(comments.length).toBeGreaterThan(0);
    for (const c of comments) expect(saved, c).toContain(c);
    expect(rec(YAML.load(saved)).schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(await fs.readFile(path.join(path.dirname(configPath), "config.v2.bak.yaml"), "utf8")).toBe(text);
  });
});
