import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import * as YAML from "js-yaml";
import type { z } from "zod";
import {
  CONFIG_SCHEMA_VERSION,
  appInputSchema,
  bookmarkInputSchema,
  integrationSchema,
  settingsInputSchema,
  newInstance,
} from "./schema";

// config.ts captures CONFIG_PATH at module load, so the env var has to be set
// before the module is imported — hence the dynamic import in beforeAll.
let config: typeof import("./config");

// Fixtures go through the same schemas the API routes parse with, so they pick
// up defaults exactly like real input and can't drift from the stored shape.
const appInput = (v: z.input<typeof appInputSchema>) => appInputSchema.parse(v);
const bookmarkInput = (v: z.input<typeof bookmarkInputSchema>) =>
  bookmarkInputSchema.parse(v);
const settingsInput = (v: z.input<typeof settingsInputSchema>) =>
  settingsInputSchema.parse(v);
let configPath: string;

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-test-"));
  configPath = path.join(dir, "config.yaml");
  process.env.CONFIG_PATH = configPath;
  config = await import("./config");
});

beforeEach(async () => {
  // Start each test from a clean slate; readConfigInternal recreates defaults on miss.
  await fs.rm(configPath, { force: true });
  await fs.rm(`${configPath}.bak`, { force: true });
  await fs.rm(path.join(path.dirname(configPath), "config.v2.bak.yaml"), { force: true });
  await fs.rm(path.join(path.dirname(configPath), "upgrade-notice.json"), { force: true });
});


// One v3 layout row by the instance it places.
const rowOf = <T extends { widget: string }>(sections: readonly T[], widget: string) =>
  sections.find((r) => r.widget === widget);

describe("comment-preserving writes (#279)", () => {
  const comments = (text: string) =>
    text.split("\n").filter((l) => /^\s*#/.test(l) || / #/.test(l));

  it("keeps the example config's comments through admin edits", async () => {
    const example = await fs.readFile(
      path.join(__dirname, "..", "config", "config.example.yaml"),
      "utf8"
    );
    await fs.writeFile(configPath, example, "utf8");
    const before = comments(example);
    expect(before.length).toBeGreaterThan(5);

    const app = await config.createApp(appInput({ name: "Added", url: "https://added.test" }));
    await config.updateSettings(settingsInput({ title: "Renamed" }));
    const ids = (await config.listApps()).map((a) => a.id);
    await config.reorderApps([...ids].reverse());
    await config.deleteApp(app.id);

    const after = await fs.readFile(configPath, "utf8");
    for (const line of before) expect(after).toContain(line.trim());
    const read = await config.readConfigInternal();
    expect(read.settings.title).toBe("Renamed");
    expect(read.apps.map((a) => a.id)).toEqual(ids.filter((id) => id !== app.id).reverse());
  });

  it("still writes a file it can't edit in place (merge keys)", async () => {
    await fs.writeFile(
      configPath,
      "# anchored\nbase: &b\n  title: Home\nsettings:\n  <<: *b\n",
      "utf8"
    );
    await config.updateSettings(settingsInput({ title: "Merged" }));
    expect((await config.readConfigInternal()).settings.title).toBe("Merged");
  });
});

describe("readConfigInternal", () => {
  it("creates a default config when the file is missing", async () => {
    const result = await config.readConfigInternal();
    expect(result.apps).toEqual([]);
    expect(result.settings.title).toBe("Home");
    // The file should now exist on disk.
    const onDisk = YAML.load(await fs.readFile(configPath, "utf8"));
    expect(onDisk).toBeTruthy();
  });

  it("treats an empty or comment-only file as all defaults", async () => {
    for (const text of ["", "\n   \n", "# nothing configured yet\n"]) {
      await fs.writeFile(configPath, text, "utf8");
      const result = await config.readConfigInternal();
      expect(result.settings.title).toBe("Home");
      expect(result.apps).toEqual([]);
    }
  });

  it("honors YAML merge keys and keeps unquoted dates as strings", async () => {
    await fs.writeFile(
      configPath,
      [
        "defaults: &app",
        "  subtitle: shared",
        "  icon: ''",
        "apps:",
        "  - <<: *app",
        "    id: a1",
        "    name: Plex",
        "    url: https://plex.example.com",
        "settings:",
        "  title: 2026-12-25",
        "",
      ].join("\n"),
      "utf8"
    );
    const result = await config.readConfigInternal();
    expect(result.apps[0]).toMatchObject({ name: "Plex", subtitle: "shared" });
    expect(result.settings.title).toBe("2026-12-25");
  });

  it("stamps the schema version on write, and reads files without one", async () => {
    // A pre-field file (no schemaVersion) reads fine…
    await fs.writeFile(configPath, YAML.dump({ settings: { title: "Old" } }), "utf8");
    expect((await config.readConfigInternal()).settings.title).toBe("Old");
    // …and the next write records the current version.
    await config.updateSettings(settingsInput({ title: "New" }));
    const onDisk = YAML.load(await fs.readFile(configPath, "utf8")) as {
      schemaVersion: number;
    };
    expect(onDisk.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
  });

  it("refuses a file written by a newer release, leaving it untouched (#288)", async () => {
    const newer = YAML.dump({ schemaVersion: CONFIG_SCHEMA_VERSION + 1, settings: {}, boards: [] });
    await fs.writeFile(configPath, newer, "utf8");
    await expect(config.readConfigInternal()).rejects.toThrow(/newer CtrlCenter/);
    expect(await fs.readFile(configPath, "utf8")).toBe(newer);
  });

  it("rejects a file with more than one YAML document", () => {
    expect(() => config.parseConfigYaml("a: 1\n---\nb: 2\n")).toThrow(
      /single YAML document/
    );
  });

  it("drops a malformed hand-edited row instead of failing the whole load", async () => {
    // One valid app and two invalid ones (bad URL, empty name) written by hand.
    await fs.writeFile(
      configPath,
      YAML.dump({
        apps: [
          { id: "a", name: "Good", url: "https://ok.example.com" },
          { id: "b", name: "Bad URL", url: "not-a-url" },
          { id: "c", name: "", url: "https://empty-name.example.com" },
        ],
      }),
      "utf8"
    );
    const result = await config.readConfigInternal();
    expect(result.apps.map((a) => a.id)).toEqual(["a"]);
  });
});

describe("read cache", () => {
  it("hands each caller its own copy", async () => {
    const a = await config.readConfigInternal();
    a.settings.title = "mutated by a caller";
    a.apps.push({ ...a.apps[0], id: "ghost" } as (typeof a.apps)[number]);
    const b = await config.readConfigInternal();
    expect(b.settings.title).toBe("Home");
    expect(b.apps.find((x) => x.id === "ghost")).toBeUndefined();
  });

  it("sees writes and hand edits immediately", async () => {
    await config.readConfigInternal();
    await config.updateSettings(settingsInput({ title: "Via API" }));
    expect((await config.readConfigInternal()).settings.title).toBe("Via API");

    // A hand edit replaces the file outside the app (new mtime/size).
    const onDisk = YAML.load(await fs.readFile(configPath, "utf8")) as {
      settings: { title: string };
    };
    onDisk.settings.title = "Hand edited";
    await fs.writeFile(configPath, YAML.dump(onDisk), "utf8");
    expect((await config.readConfigInternal()).settings.title).toBe("Hand edited");
  });
});

describe("apps CRUD", () => {
  it("mints a push token when an app switches to push, and keeps it (#294)", async () => {
    const created = await config.createApp(appInput({ name: "Job", url: "https://job.test" }));
    expect(created.pushToken).toBe("");
    const pushed = await config.updateApp(created.id, { checkType: "push" });
    expect(pushed.pushToken).toMatch(/^[\w-]{20,}$/);
    await config.updateApp(created.id, { checkType: "http" });
    const back = await config.updateApp(created.id, { checkType: "push" });
    expect(back.pushToken).toBe(pushed.pushToken);
    // Never handed to a public surface.
    expect(config.stripSecrets(await config.readConfigInternal()).apps.find((a) => a.id === created.id)!.pushToken).toBe("");
  });

  it("stores per-app check overrides, and null clears one back to the default (#292)", async () => {
    const created = await config.createApp(
      appInput({ name: "NAS", url: "https://nas.test", interval: 15, timeout: 10, retries: 2, port: 8080 })
    );
    expect(created).toMatchObject({ interval: 15, timeout: 10, retries: 2, port: 8080 });
    // An omitted field keeps its value; null removes it.
    const updated = await config.updateApp(created.id, { interval: null, port: null, retries: 3 });
    expect(updated.interval).toBeUndefined();
    expect(updated.port).toBeUndefined();
    expect(updated).toMatchObject({ timeout: 10, retries: 3 });
    const stored = (await config.listApps()).find((a) => a.id === created.id)!;
    expect("interval" in stored).toBe(false);
  });

  it("creates an app with a generated id and persists it", async () => {
    const created = await config.createApp(appInput({
      name: "Plex",
      subtitle: "Movies",
      url: "https://plex.example.com",
      icon: "plex",
    }));
    expect(created.id).toBeTruthy();

    const apps = await config.listApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: "Plex", id: created.id });
  });

  it("partially updates an app, leaving other fields untouched", async () => {
    const created = await config.createApp(appInput({
      name: "Plex",
      subtitle: "Movies",
      url: "https://plex.example.com",
      icon: "plex",
    }));

    const updated = await config.updateApp(created.id, { name: "Plex TV" });
    expect(updated).toMatchObject({
      name: "Plex TV",
      subtitle: "Movies",
      url: "https://plex.example.com",
      icon: "plex",
    });
  });

  it("throws NotFoundError when updating a non-existent app", async () => {
    await expect(
      config.updateApp("missing", { name: "x" })
    ).rejects.toBeInstanceOf(config.NotFoundError);
  });

  it("deletes an app", async () => {
    const created = await config.createApp(appInput({
      name: "Plex",
      subtitle: "",
      url: "https://plex.example.com",
      icon: "",
    }));
    await config.deleteApp(created.id);
    expect(await config.listApps()).toHaveLength(0);
  });

  it("restores a deleted app with its id at its old position, once (#307)", async () => {
    const make = (name: string) =>
      config.createApp(appInput({ name, url: `https://${name}.example.com` }));
    const a = await make("a");
    const b = await make("b");
    const c = await make("c");
    await config.deleteApp(b.id);
    await config.restoreApp(b, 1);
    // A second Undo (double click) is a no-op, not a duplicate.
    await config.restoreApp(b, 1);
    expect((await config.listApps()).map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    // An index past the end clamps to append.
    await config.deleteApp(a.id);
    await config.restoreApp(a, 99);
    expect((await config.listApps()).map((x) => x.name)).toEqual(["b", "c", "a"]);
  });
});

describe("updateSettings generic merge (#287)", () => {
  it("deep-merges a nested section, keeping keys the patch leaves out", async () => {
    await config.updateSettings(
      settingsInput({ alerts: { enabled: true, type: "ntfy", webhookUrl: "https://ntfy.test/x", notifyOnRecovery: true, confirmations: 2, email: { enabled: true, host: "smtp.test", port: 587, secure: false, subject: "", user: "u", pass: "p", from: "a@test", to: "b@test" } } })
    );
    // A later patch touching one email field leaves the rest of the section.
    await config.updateSettings({ alerts: { email: { host: "smtp2.test" } } } as never);
    const alerts = (await config.getSettings()).alerts;
    expect(alerts.email).toMatchObject({ host: "smtp2.test", user: "u", pass: "p", enabled: true });
    expect(alerts.webhookUrl).toBe("https://ntfy.test/x");
  });

  it("replaces the theme whole, so an omitted custom color is cleared", async () => {
    const base = (await config.getSettings()).theme;
    await config.updateSettings(settingsInput({ theme: { ...base, background: "#101010" } }));
    expect((await config.getSettings()).theme.background).toBe("#101010");
    await config.updateSettings(settingsInput({ theme: { ...base } }));
    expect((await config.getSettings()).theme.background).toBeUndefined();
  });

  it("replaces lists, so removing an entry persists", async () => {
    const bang = (key: string) => ({ key, url: `https://${key}.example.com/?q=%s` });
    await config.updateSettings(settingsInput({ search: { bangs: [bang("a"), bang("b")] } }));
    await config.updateSettings(settingsInput({ search: { bangs: [bang("b")] } }));
    expect((await config.getSettings()).search.bangs.map((b) => b.key)).toEqual(["b"]);
  });
});

describe("updateSettings partial merge", () => {
  it("updates a top-level field without clobbering the others", async () => {
    await config.updateSettings(settingsInput({
      theme: {
        mode: "dark",
        design: "cyber",
        scene: "abyss",
        font: "jakarta",
        accentFrom: "#a78bfa",
        accentTo: "#22d3ee",
      },
      timezone: "America/Chicago",
    }));
    const settings = await config.updateSettings(settingsInput({ title: "Dash" }));

    expect(settings.title).toBe("Dash");
    expect(settings.theme.mode).toBe("dark");
    expect(settings.theme.design).toBe("cyber");
    expect(settings.theme.scene).toBe("abyss");
    expect(settings.timezone).toBe("America/Chicago");
  });

  it("keeps a deleted feed url deleted after migrating a legacy single-url config", async () => {
    // A pre-1.9.6 config: a single legacy `url`, no `urls` list yet.
    await fs.writeFile(
      configPath,
      YAML.dump({
        settings: { feed: { enabled: true, url: "https://old.example/rss" } },
      }),
      "utf8"
    );
    // The migrations fold the single feed into a feed widget instance (#297)…
    const loaded = await config.readConfigInternal();
    const feed = loaded.widgets.find((w) => w.type === "feed")!;
    expect(feed.type === "feed" && feed.urls).toEqual(["https://old.example/rss"]);
    // …and the admin then clears the row, saving the whole widget list with an
    // empty url list. Nothing is left on disk to resurrect the feed from.
    await config.replaceWidgets(
      loaded.widgets.map((w) => (w.type === "feed" ? { ...w, urls: [] } : w))
    );
    const onDisk = YAML.load(await fs.readFile(configPath, "utf8")) as {
      settings: Record<string, unknown>;
      widgets: Record<string, unknown>[];
    };
    expect("feed" in onDisk.settings).toBe(false);
    expect("feeds" in onDisk.settings).toBe(false);
    expect(onDisk.widgets.find((w) => w.type === "feed")?.urls).toEqual([]);
  });

  it("merges nested weather fields without dropping siblings", async () => {
    await config.updateSettings(settingsInput({
      weather: { latitude: 40, longitude: -75 },
    }));
    const settings = await config.updateSettings(settingsInput({
      weather: { units: "metric" },
    }));

    expect(settings.weather.units).toBe("metric");
    expect(settings.weather.latitude).toBe(40);
    expect(settings.weather.longitude).toBe(-75);
  });

  it("replaces the theme wholesale so custom colors can be cleared", async () => {
    await config.updateSettings(settingsInput({
      theme: {
        mode: "dark",
        design: "glass",
        scene: "aurora",
        font: "jakarta",
        accentFrom: "#a78bfa",
        accentTo: "#22d3ee",
        background: "#101010",
        foreground: "#fafafa",
      },
    }));
    // Re-saving without the colors drops them rather than merging them back in.
    const settings = await config.updateSettings(settingsInput({
      theme: {
        mode: "light",
        design: "flat",
        scene: "aurora",
        font: "jakarta",
        accentFrom: "#a78bfa",
        accentTo: "#22d3ee",
      },
    }));

    expect(settings.theme.mode).toBe("light");
    expect(settings.theme.design).toBe("flat");
    expect(settings.theme.background).toBeUndefined();
    expect(settings.theme.foreground).toBeUndefined();
  });

  it("merges the page-level layout values key by key", async () => {
    await config.updateSettings(settingsInput({ layout: { scale: 110, gap: 16 } }));
    const settings = await config.updateSettings(settingsInput({ layout: { gap: 24 } }));
    expect(settings.layout).toMatchObject({ scale: 110, gap: 24 });
  });

  it("rewrites a legacy width layout to spans on the first read, with a .bak", async () => {
    // A pre-1.3 config on disk, arranged with the old width enum.
    const legacy = {
      settings: {
        layout: { sections: [{ id: "apps", width: "half" }] },
      },
    };
    await fs.writeFile(configPath, YAML.dump(legacy), "utf8");
    const loaded = await config.readConfigInternal();
    expect(rowOf(loaded.boards[0].layout.sections, "apps")).toEqual({ widget: "apps", span: 12, hidden: false });

    // The read itself persisted the span shape, on the home board (#298)…
    const onDisk = YAML.load(await fs.readFile(configPath, "utf8")) as {
      boards: { layout: { sections: { widget: string }[]; columns: number } }[];
    };
    expect(rowOf(onDisk.boards[0].layout.sections, "apps")).toEqual({ widget: "apps", span: 12, hidden: false });
    expect(onDisk.boards[0].layout).not.toHaveProperty("columns");
    // …after snapshotting the pre-migration file verbatim to the .bak.
    const bak = YAML.load(await fs.readFile(`${configPath}.bak`, "utf8"));
    expect(bak).toEqual(legacy);
  });

  it("snapshots the original to .bak when a mutation is the first op on a legacy file", async () => {
    // A pre-2.0 config reaches disk (e.g. an upgrade) and the very first
    // operation is a WRITE — a direct API mutation before any page read
    // triggered the read-path migration + backup. The mutation still migrates
    // the file, so it must take the same .bak snapshot itself.
    const legacy = { settings: { feed: { enabled: true, url: "https://old.example/rss" } } };
    const legacyText = YAML.dump(legacy);
    await fs.writeFile(configPath, legacyText, "utf8");

    // createApp() is the first read-or-write this process makes on the file.
    await config.createApp(appInput({
      name: "First", subtitle: "", url: "https://first.example.com", icon: "",
    }));

    // The untouched original was snapshotted verbatim before the rewrite…
    expect(await fs.readFile(`${configPath}.bak`, "utf8")).toBe(legacyText);
    // …and the live file is migrated (feed folded) with the mutation applied.
    const onDisk = YAML.load(await fs.readFile(configPath, "utf8")) as {
      settings: { feed?: unknown };
      widgets: Record<string, unknown>[];
      apps: { name: string }[];
    };
    expect("feed" in onDisk.settings).toBe(false);
    expect(onDisk.widgets.find((w) => w.type === "feed")?.urls).toEqual(["https://old.example/rss"]);
    expect(onDisk.apps.map((a) => a.name)).toEqual(["First"]);
  });

  it("does not write a spurious .bak when mutating a current-shape config", async () => {
    // A mutation on an already-current file must NOT snapshot — otherwise every
    // write would clobber a real import backup with the live config.
    await config.updateSettings(settingsInput({ title: "Current" }));
    await fs.rm(`${configPath}.bak`, { force: true });
    await config.createApp(appInput({
      name: "X", subtitle: "", url: "https://x.example.com", icon: "",
    }));
    await expect(fs.access(`${configPath}.bak`)).rejects.toBeTruthy();
  });

  describe("the 2.x → 3.0 upgrade (#306)", () => {
    const v2Text = [
      "# my homelab",
      "schemaVersion: 2",
      "settings:",
      "  title: Lab",
      "  notes: { content: hello }",
      "  layout:",
      "    sections:",
      "      - { id: notes, span: 8 }",
      "      - { id: apps, span: 24 }",
      "apps:",
      "  - { id: a1, name: NAS, url: 'http://nas.lan' }",
      "bookmarks:",
      "  - { id: b1, name: Wiki, url: 'https://wiki.example', category: Docs }",
      "",
    ].join("\n");
    const v2Backup = () => path.join(path.dirname(configPath), "config.v2.bak.yaml");

    it("keeps the 2.x file once as config.v2.bak.yaml, and leaves the admin a notice", async () => {
      await fs.writeFile(configPath, v2Text, "utf8");
      const loaded = await config.readConfigInternal();
      expect(loaded.boards[0].layout.sections.map((r) => r.widget)).toContain("notes");
      expect(await fs.readFile(v2Backup(), "utf8")).toBe(v2Text);
      const notice = await config.readUpgradeNotice();
      expect(notice).toMatchObject({ from: 2, to: 3, boards: 1, backup: "config.v2.bak.yaml" });
      expect(notice!.widgets).toBeGreaterThan(0);
      expect(notice!.groups).toBe(1);
      await config.dismissUpgradeNotice();
      expect(await config.readUpgradeNotice()).toBeNull();
    });

    it("never overwrites an existing v2 backup, and upgrades on a first write too", async () => {
      await fs.writeFile(v2Backup(), "the first upgrade's copy", "utf8");
      await fs.writeFile(configPath, v2Text, "utf8");
      await config.createApp(appInput({ name: "First", url: "https://first.example.com" }));
      expect(await fs.readFile(v2Backup(), "utf8")).toBe("the first upgrade's copy");
      expect(await config.readUpgradeNotice()).toMatchObject({ from: 2, to: 3 });
    });

    it("leaves a 3.0 config alone", async () => {
      await config.updateSettings(settingsInput({ title: "Already 3" }));
      await config.readConfigInternal();
      await expect(fs.access(v2Backup())).rejects.toBeTruthy();
      expect(await config.readUpgradeNotice()).toBeNull();
    });
  });

  it("doubles a 1.3-era 12-column span layout once, and never again", async () => {
    // A 1.3 config on disk: spans on the 12-column grid, no `columns` marker.
    await fs.writeFile(
      configPath,
      YAML.dump({
        settings: {
          layout: {
            sections: [
              { id: "apps", span: 6, hidden: false },
              { id: "search", span: 12, hidden: false },
            ],
          },
        },
      }),
      "utf8"
    );
    const loaded = await config.readConfigInternal();
    expect(rowOf(loaded.boards[0].layout.sections, "apps")?.span).toBe(12);
    expect(rowOf(loaded.boards[0].layout.sections, "search")?.span).toBe(24);

    // The first read persisted the doubled spans + marker; later reads and
    // writes must not double them a second time.
    await config.updateSettings(settingsInput({ title: "Dash" }));
    const reloaded = await config.readConfigInternal();
    expect(rowOf(reloaded.boards[0].layout.sections, "apps")?.span).toBe(12);
    expect(rowOf(reloaded.boards[0].layout.sections, "search")?.span).toBe(24);
    expect(reloaded.boards[0].layout).not.toHaveProperty("columns");
  });

  it("migrates a pre-2.0 backup file on import", async () => {
    // An export taken before 2.0.0 carries the legacy shapes; replaceConfig
    // must fold them exactly like the on-disk migration does.
    const replaced = await config.replaceConfig({
      settings: {
        feed: { enabled: true, url: "https://old.example/rss" },
        layout: {
          sections: [
            { id: "apps", span: 6, hidden: false },
            { id: "bookmarks", width: "half", spaceBelow: 40 },
          ],
        },
      },
      apps: [],
      bookmarks: [],
    });
    const feed = replaced.widgets.find((w) => w.type === "feed");
    expect(feed?.type === "feed" && feed.urls).toEqual(["https://old.example/rss"]);
    expect(rowOf(replaced.boards[0].layout.sections, "apps")).toEqual({ widget: "apps", span: 12, hidden: false });
    expect(rowOf(replaced.boards[0].layout.sections, "bookmarks")).toEqual({
      widget: "bookmarks",
      span: 12,
      hidden: false,
      space: { bottom: 40 },
    });
    expect(replaced.boards[0].layout).not.toHaveProperty("columns");
  });
});

describe("reorderApps", () => {
  async function seedThree() {
    const a = await config.createApp(appInput({ name: "A", subtitle: "", url: "https://a.com", icon: "" }));
    const b = await config.createApp(appInput({ name: "B", subtitle: "", url: "https://b.com", icon: "" }));
    const c = await config.createApp(appInput({ name: "C", subtitle: "", url: "https://c.com", icon: "" }));
    return { a, b, c };
  }

  it("reorders apps to match the given id order", async () => {
    const { a, b, c } = await seedThree();
    const result = await config.reorderApps([c.id, a.id, b.id]);
    expect(result.map((x) => x.name)).toEqual(["C", "A", "B"]);
  });

  it("appends unlisted items and ignores unknown ids", async () => {
    const { b } = await seedThree();
    // Only mention b (plus a bogus id); a and c should be kept, appended in order.
    const result = await config.reorderApps([b.id, "does-not-exist"]);
    expect(result.map((x) => x.name)).toEqual(["B", "A", "C"]);
    expect(result).toHaveLength(3);
  });
});

describe("groups (#299)", () => {
  const bm = (groupName: string, name: string) =>
    config.createBookmark(bookmarkInput({ groupName, name, url: `https://${name.toLowerCase()}.example.com` }));

  it("creates a group the first time a form names it, and reuses it by name in any case", async () => {
    const a = await bm("Media", "Plex");
    const b = await bm("  media ", "Jellyfin");
    expect(a.group).toBe("media");
    expect(b.group).toBe("media");
    const app = await config.createApp(appInput({ name: "Sonarr", url: "https://sonarr.example.com", groupName: "Media" }));
    expect(app.group).toBe("media");
    const none = await config.createApp(appInput({ name: "Solo", url: "https://solo.example.com" }));
    expect(none.group).toBe("");
    expect((await config.readConfigInternal()).groups).toEqual([{ id: "media", name: "Media" }]);
  });

  it("keeps a new name's id unique", async () => {
    await bm("Media", "Plex");
    await config.replaceGroups([{ id: "media", name: "Films" }]);
    const b = await bm("Media", "Jellyfin");
    expect(b.group).toBe("media-2");
  });

  it("renames and reorders without touching the items", async () => {
    await bm("Dev", "GitHub");
    await bm("Media", "Plex");
    const result = await config.replaceGroups([
      { id: "media", name: "Streaming" },
      { id: "dev", name: "Dev" },
    ]);
    expect(result.groups).toEqual([
      { id: "media", name: "Streaming" },
      { id: "dev", name: "Dev" },
    ]);
    expect(result.bookmarks.map((b) => b.group)).toEqual(["dev", "media"]);
  });

  it("merges a group renamed onto another's name into the earlier one, filters included", async () => {
    await bm("Dev", "GitHub");
    await bm("Media", "Plex");
    await config.updateApp(
      (await config.createApp(appInput({ name: "Gitea", url: "https://gitea.example.com", groupName: "Media" }))).id,
      {}
    );
    await config.replaceWidgets([
      newInstance("greeting", "greeting"),
      { ...newInstance("apps", "media-apps"), filter: { group: "media", tag: "", private: "any" } },
    ]);
    const result = await config.replaceGroups([
      { id: "dev", name: "Dev" },
      { id: "media", name: "dev" },
    ]);
    expect(result.groups).toEqual([{ id: "dev", name: "Dev" }]);
    expect(result.bookmarks.every((b) => b.group === "dev")).toBe(true);
    expect(result.apps[0].group).toBe("dev");
    const stored = await config.readConfigInternal();
    const media = stored.widgets.find((w) => w.id === "media-apps");
    expect(media?.type === "apps" && media.filter.group).toBe("dev");
  });

  it("deletes only an unused group", async () => {
    await bm("Dev", "GitHub");
    await expect(config.replaceGroups([])).rejects.toBeInstanceOf(config.GroupInUseError);
    await config.replaceGroups([{ id: "dev", name: "Dev" }, { id: "spare", name: "Spare" }]);
    const result = await config.replaceGroups([{ id: "dev", name: "Dev" }]);
    expect(result.groups.map((g) => g.id)).toEqual(["dev"]);
  });

  it("bulk-moves and tags apps", async () => {
    const a = await config.createApp(appInput({ name: "A", url: "https://a.example.com", tags: ["x"] }));
    const b = await config.createApp(appInput({ name: "B", url: "https://b.example.com" }));
    const moved = await config.bulkUpdateApps({ ids: [a.id, b.id, "gone"], groupName: "Infra" });
    expect(moved.apps.map((x) => x.group)).toEqual(["infra", "infra"]);
    expect(moved.groups).toEqual([{ id: "infra", name: "Infra" }]);
    const tagged = await config.bulkUpdateApps({ ids: [a.id], addTags: ["X", "y"] });
    expect(tagged.apps[0].tags).toEqual(["x", "y"]);
    const out = await config.bulkUpdateApps({ ids: [b.id], groupName: "" });
    expect(out.apps[1].group).toBe("");
  });
});

describe("updateBookmark", () => {
  it("throws NotFoundError when updating a non-existent bookmark", async () => {
    await expect(
      config.updateBookmark("missing", { name: "x" })
    ).rejects.toBeInstanceOf(config.NotFoundError);
  });
});

describe("replaceConfig", () => {
  it("validates and replaces the whole config", async () => {
    await config.createApp(appInput({ name: "Old", subtitle: "", url: "https://old.com", icon: "" }));
    const replaced = await config.replaceConfig({
      settings: { title: "Imported" },
      apps: [{ id: "x1", name: "New", subtitle: "", url: "https://new.com", icon: "" }],
      bookmarks: [],
    });
    expect(replaced.settings.title).toBe("Imported");
    expect(replaced.apps.map((a) => a.name)).toEqual(["New"]);

    // Persisted to disk and readable back.
    const reread = await config.readConfigInternal();
    expect(reread.apps.map((a) => a.name)).toEqual(["New"]);
  });

  it("rejects an invalid config", async () => {
    await expect(
      config.replaceConfig({ apps: [{ id: "x", name: "" }] })
    ).rejects.toBeTruthy();
  });

  it("preserves the admin password when importing a config without auth", async () => {
    // An exported backup carries no auth (see stripAuth); importing it must not
    // wipe the password and silently drop the instance to passwordless.
    await config.setPasswordHash("HASH", "SALT");
    const replaced = await config.replaceConfig({
      settings: { title: "Imported" },
      apps: [],
      bookmarks: [],
    });
    expect(replaced.auth).toMatchObject({ passwordHash: "HASH", passwordSalt: "SALT" });

    const reread = await config.readConfigInternal();
    expect(reread.auth).toMatchObject({ passwordHash: "HASH", passwordSalt: "SALT" });
    expect(reread.settings.title).toBe("Imported");
  });

  it("snapshots the pre-import config to a .bak beside the config file", async () => {
    // Seed a distinctive pre-import state, then import over it.
    await config.createApp(appInput({
      name: "PreImport",
      subtitle: "",
      url: "https://pre.example.com",
      icon: "",
    }));
    await config.updateSettings(settingsInput({ title: "Before" }));

    await config.replaceConfig({
      settings: { title: "After" },
      apps: [
        { id: "n1", name: "New", subtitle: "", url: "https://new.com", icon: "" },
      ],
      bookmarks: [],
    });

    // The .bak sits next to config.yaml and parses back to the PRE-import state.
    const bak = YAML.load(await fs.readFile(`${configPath}.bak`, "utf8")) as {
      settings: { title: string };
      apps: { name: string }[];
    };
    expect(bak.settings.title).toBe("Before");
    expect(bak.apps.map((a) => a.name)).toEqual(["PreImport"]);
  });

  it("snapshots the raw pre-import bytes, keeping hand-added keys the schema would strip", async () => {
    // A hand-edited config can carry keys the schema doesn't know; the .bak is
    // the only recovery artifact, so it must preserve them verbatim rather than
    // save a parsed (key-stripped) copy.
    const handEdited = "settings:\n  title: Hand\n  myCustomNote: keep-me\napps: []\nbookmarks: []\n";
    await fs.writeFile(configPath, handEdited, "utf8");
    await config.replaceConfig({ settings: { title: "Imported" }, apps: [], bookmarks: [] });
    // Byte-identical original, unknown key intact.
    expect(await fs.readFile(`${configPath}.bak`, "utf8")).toBe(handEdited);
  });

  it("overwrites the .bak with the config current at the time of each import", async () => {
    await config.replaceConfig({
      settings: { title: "First" },
      apps: [
        { id: "a1", name: "First app", subtitle: "", url: "https://first.com", icon: "" },
      ],
      bookmarks: [],
    });
    // "First" is now the live config; a second import must back THAT up, not the
    // original default that the first import backed up.
    await config.replaceConfig({
      settings: { title: "Second" },
      apps: [
        { id: "a2", name: "Second app", subtitle: "", url: "https://second.com", icon: "" },
      ],
      bookmarks: [],
    });

    const bak = YAML.load(await fs.readFile(`${configPath}.bak`, "utf8")) as {
      settings: { title: string };
      apps: { name: string }[];
    };
    expect(bak.settings.title).toBe("First");
    expect(bak.apps.map((a) => a.name)).toEqual(["First app"]);
  });

  it("ignores any auth carried in an imported file (can't overwrite the password)", async () => {
    // A backup from another instance shouldn't be able to change this one's
    // password; the on-disk credential always wins.
    await config.setPasswordHash("MINE", "MYSALT");
    const replaced = await config.replaceConfig({
      settings: {},
      apps: [],
      bookmarks: [],
      auth: { passwordHash: "THEIRS", passwordSalt: "THEIRSALT" },
    });
    expect(replaced.auth).toMatchObject({ passwordHash: "MINE", passwordSalt: "MYSALT" });
  });
});

describe("stripAuth", () => {
  it("removes the credential from the exported config surface", async () => {
    await config.setPasswordHash("HASH", "SALT");
    const full = await config.readConfigInternal();
    expect(full.auth.passwordHash).toBe("HASH"); // present on disk

    const exported = config.stripAuth(full);
    expect("auth" in exported).toBe(false); // but never exported
    // Everything else still rides along.
    expect(exported.settings.title).toBe("Home");
    expect(exported.apps).toEqual([]);
  });

  it("does not mutate the config it's given", async () => {
    const full = await config.readConfigInternal();
    config.stripAuth(full);
    expect(full.auth).toBeTruthy();
  });
});

describe("write queue serialization", () => {
  it("does not lose writes under concurrent mutations", async () => {
    // Fire many creates without awaiting between them. Without the serializing
    // write queue these read-modify-write cycles would clobber each other and
    // only the last write would survive.
    const creates = Array.from({ length: 10 }, (_, i) =>
      config.createApp(appInput({
        name: `App ${i}`,
        subtitle: "",
        url: `https://app${i}.example.com`,
        icon: "",
      }))
    );
    await Promise.all(creates);

    const apps = await config.listApps();
    expect(apps).toHaveLength(10);
    // All ids should be unique.
    expect(new Set(apps.map((a) => a.id)).size).toBe(10);
  });
});

describe("spendTotpRecoveryCode", () => {
  it("spends a code exactly once, even when two logins race", async () => {
    const codes = [
      { hash: "h1", salt: "s1" },
      { hash: "h2", salt: "s2" },
    ];
    await config.activateTotp("SECRET", codes);
    const results = await Promise.all([
      config.spendTotpRecoveryCode("h1"),
      config.spendTotpRecoveryCode("h1"),
    ]);
    expect(results.sort()).toEqual([false, true]);
    const { auth } = await config.readConfigInternal();
    expect(auth.totp.recoveryCodes.map((c) => c.hash)).toEqual(["h2"]);
    expect(await config.spendTotpRecoveryCode("nope")).toBe(false);
    await config.disableTotp();
  });
});

// Structural guard for #147: private apps/bookmarks are pre-filtered by
// readPublicConfig (lib/api-auth.ts), so the raw read must stay off public
// surfaces. Every file under app/ that touches readConfigInternal has to be
// pinned here; a new public page or endpoint reaching for it fails this test
// and gets pointed at the safe accessor instead.
describe("readConfigInternal stays off public surfaces", () => {
  const ALLOWED = [
    // Admin-only (proxy-gated) pages and routes.
    "app/admin/page.tsx",
    "app/api/alerts/test/route.ts",
    "app/api/config/route.ts",
    "app/api/password/route.ts",
    // Admin-only integration snapshot: reads once, then gates on the hash.
    "app/api/monitor/route.ts",
    // Admin-only per-service detail: same read-once-then-gate as the snapshot.
    "app/api/monitor/[id]/route.ts",
    // Auth itself: verifies the password / issues the session.
    "app/api/login/route.ts",
    // Public login page: reads `auth` only to pass one boolean (is any admin
    // password configured, #275) to the form. Nothing else reaches the client.
    "app/admin/login/page.tsx",
    // Admin-only 2FA management: read the current TOTP state before mutating.
    "app/api/2fa/activate/route.ts",
    "app/api/2fa/disable/route.ts",
    // Public, but their shared cache must hold every app; each filters per
    // response via visibleItems (the [id] detail route 404s non-visible ids).
    "app/api/status/route.ts",
    "app/api/status/history/route.ts",
    "app/api/status/history/[id]/route.ts",
    // Public but token-gated inbound webhooks (#204): needs the unfiltered
    // config to check the per-service token and to read the alert-channel
    // secrets it relays through. It never serializes config back to the caller.
    "app/api/hooks/[service]/route.ts",
    // Public but token-gated push pings (#294): matches the per-app token,
    // which only the unfiltered config carries. Answers with no config data.
    "app/api/push/[token]/route.ts",
  ];

  it("only allowlisted files under app/ use the unfiltered read", async () => {
    const appDir = path.join(__dirname, "..", "app");
    const found: string[] = [];
    async function walk(dir: string) {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        // Tests aren't served, so they're no surface.
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const source = await fs.readFile(full, "utf8");
          if (source.includes("readConfigInternal")) {
            found.push(path.relative(path.join(__dirname, ".."), full));
          }
        }
      }
    }
    await walk(appDir);
    expect(
      found.sort(),
      "A public surface must read config through readPublicConfig " +
        "(lib/api-auth.ts), which filters private items; extend the " +
        "allowlist only for admin-gated or deliberately unfiltered surfaces."
    ).toEqual([...ALLOWED].sort());
  });
});

// #157: the secrets embedded in settings (calendar credentials, alert
// webhook/SMTP) must be blanked by stripSecrets so readPublicConfig's result is
// safe to serialize, while the server-only getCalendarAuth still yields the real
// values for the home-page fetch.
describe("settings-secret redaction", () => {
  // The calendar is a widget instance since 3.0 (#297).
  const calendar = {
    ...newInstance("calendar", "calendar"),
    url: "https://cal.example.com/private.ics",
    username: "alice",
    password: "cal-secret",
  };
  const withSecrets = {
    alerts: {
      enabled: true,
      type: "generic" as const,
      webhookUrl: "https://hooks.example.com/T0/B0/xyz",
      notifyOnRecovery: true,
      confirmations: 2,
      email: {
        enabled: true,
        host: "smtp.example.com",
        port: 587,
        secure: false,
        subject: "",
        user: "mailer",
        pass: "smtp-secret",
        from: "alerts@example.com",
        to: "me@example.com",
      },
    },
  };

  it("stripSecrets blanks every credential while keeping non-secret fields", async () => {
    await config.updateSettings(settingsInput(withSecrets));
    await config.replaceWidgets([calendar]);
    await config.replaceIntegrations([
      integrationSchema.parse({ id: "qbittorrent", type: "qbittorrent", url: "http://qbit.lan:8080", username: "admin", password: "qbit-secret" }),
      integrationSchema.parse({ id: "sonarr", type: "sonarr", url: "http://sonarr.lan:8989", apiKey: "sonarr-secret" }),
    ]);
    const full = await config.readConfigInternal();

    const pub = config.stripSecrets(config.stripAuth(full));
    const pubCal = pub.widgets.find((w) => w.id === "calendar")!;
    expect(pubCal).toMatchObject({ username: "", password: "" });
    expect(pub.settings.alerts.webhookUrl).toBe("");
    expect(pub.settings.alerts.email.user).toBe("");
    expect(pub.settings.alerts.email.pass).toBe("");
    expect(pub.settings.alerts.email.host).toBe("");
    expect(pub.settings.alerts.email.from).toBe("");
    expect(pub.settings.alerts.email.to).toBe("");
    // Integrations (#189, #300): the whole list goes — credentials, URLs
    // (internal topology), even which services are connected.
    expect(pub.integrations).toEqual([]);

    // Non-secret fields survive so the widgets/nav still render and fetch.
    expect(pubCal).toMatchObject({ url: calendar.url });
    expect(pub.settings.alerts.enabled).toBe(true);
    expect(pub.settings.alerts.email.port).toBe(587);

    // Redaction doesn't mutate the source config.
    expect(full.widgets.find((w) => w.id === "calendar")).toMatchObject({ password: "cal-secret" });
    expect(full.settings.alerts.email.pass).toBe("smtp-secret");
    expect(full.integrations.map((i) => i.password || i.apiKey)).toEqual(["qbit-secret", "sonarr-secret"]);
  });

  it("getCalendarAuth still returns the real credentials server-side", async () => {
    await config.replaceWidgets([calendar]);
    expect(await config.getCalendarAuth("calendar")).toEqual({
      username: "alice",
      password: "cal-secret",
    });
    expect(await config.getCalendarAuth("nope")).toEqual({ username: "", password: "" });
  });
});
