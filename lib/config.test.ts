import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import YAML from "js-yaml";

// config.ts captures CONFIG_PATH at module load, so the env var has to be set
// before the module is imported — hence the dynamic import in beforeAll.
let config: typeof import("./config");
let configPath: string;

beforeAll(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ctrlcenter-test-"));
  configPath = path.join(dir, "config.yaml");
  process.env.CONFIG_PATH = configPath;
  config = await import("./config");
});

beforeEach(async () => {
  // Start each test from a clean slate; readConfig recreates defaults on miss.
  await fs.rm(configPath, { force: true });
});

describe("readConfig", () => {
  it("creates a default config when the file is missing", async () => {
    const result = await config.readConfig();
    expect(result.apps).toEqual([]);
    expect(result.settings.title).toBe("Home");
    // The file should now exist on disk.
    const onDisk = YAML.load(await fs.readFile(configPath, "utf8"));
    expect(onDisk).toBeTruthy();
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
    const result = await config.readConfig();
    expect(result.apps.map((a) => a.id)).toEqual(["a"]);
  });
});

describe("apps CRUD", () => {
  it("creates an app with a generated id and persists it", async () => {
    const created = await config.createApp({
      name: "Plex",
      subtitle: "Movies",
      url: "https://plex.example.com",
      icon: "plex",
    });
    expect(created.id).toBeTruthy();

    const apps = await config.listApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({ name: "Plex", id: created.id });
  });

  it("partially updates an app, leaving other fields untouched", async () => {
    const created = await config.createApp({
      name: "Plex",
      subtitle: "Movies",
      url: "https://plex.example.com",
      icon: "plex",
    });

    const updated = await config.updateApp(created.id, { name: "Plex TV" });
    expect(updated).toMatchObject({
      name: "Plex TV",
      subtitle: "Movies",
      url: "https://plex.example.com",
      icon: "plex",
    });
  });

  it("throws when updating a non-existent app", async () => {
    await expect(config.updateApp("missing", { name: "x" })).rejects.toThrow();
  });

  it("deletes an app", async () => {
    const created = await config.createApp({
      name: "Plex",
      subtitle: "",
      url: "https://plex.example.com",
      icon: "",
    });
    await config.deleteApp(created.id);
    expect(await config.listApps()).toHaveLength(0);
  });
});

describe("updateSettings partial merge", () => {
  it("updates a top-level field without clobbering the others", async () => {
    await config.updateSettings({
      theme: {
        mode: "dark",
        design: "cyber",
        scene: "abyss",
        accentFrom: "#a78bfa",
        accentTo: "#22d3ee",
      },
      timezone: "America/Chicago",
    });
    const settings = await config.updateSettings({ title: "Dash" });

    expect(settings.title).toBe("Dash");
    expect(settings.theme.mode).toBe("dark");
    expect(settings.theme.design).toBe("cyber");
    expect(settings.theme.scene).toBe("abyss");
    expect(settings.timezone).toBe("America/Chicago");
  });

  it("merges nested weather fields without dropping siblings", async () => {
    await config.updateSettings({
      weather: { latitude: 40, longitude: -75 },
    });
    const settings = await config.updateSettings({
      weather: { units: "metric" },
    });

    expect(settings.weather.units).toBe("metric");
    expect(settings.weather.latitude).toBe(40);
    expect(settings.weather.longitude).toBe(-75);
  });

  it("replaces the theme wholesale so custom colors can be cleared", async () => {
    await config.updateSettings({
      theme: {
        mode: "dark",
        design: "glass",
        scene: "aurora",
        accentFrom: "#a78bfa",
        accentTo: "#22d3ee",
        background: "#101010",
        foreground: "#fafafa",
      },
    });
    // Re-saving without the colors drops them rather than merging them back in.
    const settings = await config.updateSettings({
      theme: {
        mode: "light",
        design: "flat",
        scene: "aurora",
        accentFrom: "#a78bfa",
        accentTo: "#22d3ee",
      },
    });

    expect(settings.theme.mode).toBe("light");
    expect(settings.theme.design).toBe("flat");
    expect(settings.theme.background).toBeUndefined();
    expect(settings.theme.foreground).toBeUndefined();
  });
});

describe("reorderApps", () => {
  async function seedThree() {
    const a = await config.createApp({ name: "A", subtitle: "", url: "https://a.com", icon: "" });
    const b = await config.createApp({ name: "B", subtitle: "", url: "https://b.com", icon: "" });
    const c = await config.createApp({ name: "C", subtitle: "", url: "https://c.com", icon: "" });
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

describe("replaceConfig", () => {
  it("validates and replaces the whole config", async () => {
    await config.createApp({ name: "Old", subtitle: "", url: "https://old.com", icon: "" });
    const replaced = await config.replaceConfig({
      settings: { title: "Imported" },
      apps: [{ id: "x1", name: "New", subtitle: "", url: "https://new.com", icon: "" }],
      bookmarks: [],
    });
    expect(replaced.settings.title).toBe("Imported");
    expect(replaced.apps.map((a) => a.name)).toEqual(["New"]);

    // Persisted to disk and readable back.
    const reread = await config.readConfig();
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
    expect(replaced.auth).toEqual({ passwordHash: "HASH", passwordSalt: "SALT" });

    const reread = await config.readConfig();
    expect(reread.auth).toEqual({ passwordHash: "HASH", passwordSalt: "SALT" });
    expect(reread.settings.title).toBe("Imported");
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
    expect(replaced.auth).toEqual({ passwordHash: "MINE", passwordSalt: "MYSALT" });
  });
});

describe("stripAuth", () => {
  it("removes the credential from the exported config surface", async () => {
    await config.setPasswordHash("HASH", "SALT");
    const full = await config.readConfig();
    expect(full.auth.passwordHash).toBe("HASH"); // present on disk

    const exported = config.stripAuth(full);
    expect("auth" in exported).toBe(false); // but never exported
    // Everything else still rides along.
    expect(exported.settings.title).toBe("Home");
    expect(exported.apps).toEqual([]);
  });

  it("does not mutate the config it's given", async () => {
    const full = await config.readConfig();
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
      config.createApp({
        name: `App ${i}`,
        subtitle: "",
        url: `https://app${i}.example.com`,
        icon: "",
      })
    );
    await Promise.all(creates);

    const apps = await config.listApps();
    expect(apps).toHaveLength(10);
    // All ids should be unique.
    expect(new Set(apps.map((a) => a.id)).size).toBe(10);
  });
});
