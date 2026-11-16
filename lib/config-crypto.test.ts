import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import * as YAML from "js-yaml";
import { useScratchConfig } from "./testing/routes";
import {
  ENC_PREFIX,
  beginKeyRotation,
  credentialStatus,
  decryptValue,
  encryptValue,
  forgetConfigKeys,
  keyFilePath,
} from "./config-crypto";

// Stored credentials encrypted at rest (#370).
describe("encryptValue and decryptValue", () => {
  const key = randomBytes(32);

  it("round-trips, with a fresh nonce each time", () => {
    const a = encryptValue("hunter2", key);
    expect(a.startsWith(ENC_PREFIX)).toBe(true);
    expect(a).not.toContain("hunter2");
    expect(encryptValue("hunter2", key)).not.toBe(a);
    expect(decryptValue(a, [key])?.plain).toBe("hunter2");
  });

  it("opens with whichever key fits, and with none that doesn't", () => {
    const other = randomBytes(32);
    const sealed = encryptValue("s3cret", key);
    expect(decryptValue(sealed, [other, key])?.key.equals(key)).toBe(true);
    expect(decryptValue(sealed, [other])).toBeNull();
    // Altered by one character — the second to last, whose bits are all
    // data (the last may carry only padding) — changed to one it isn't: the
    // tag no longer matches.
    const at = sealed.length - 2;
    const tampered = sealed.slice(0, at) + (sealed[at] === "A" ? "B" : "A") + sealed.slice(at + 1);
    expect(tampered).not.toBe(sealed);
    expect(decryptValue(tampered, [key])).toBeNull();
    expect(decryptValue(`${ENC_PREFIX}short`, [key])).toBeNull();
  });
});

describe("config.yaml at rest", () => {
  let configPath: string;
  let config: typeof import("./config");

  // A fresh scratch config and module graph per test, with a qBittorrent
  // login and a Sonarr key from the environment.
  beforeEach(async () => {
    vi.resetModules();
    forgetConfigKeys();
    configPath = await useScratchConfig(
      YAML.dump({
        integrations: [
          { id: "qb", type: "qbittorrent", url: "http://qb", username: "admin", password: "hunter2" },
          { id: "sonarr", type: "sonarr", url: "http://s", apiKey: "${SONARR_KEY}" },
        ],
      })
    );
    config = await import("./config");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    forgetConfigKeys();
  });

  const onDisk = async () =>
    YAML.load(await fs.readFile(configPath, "utf8")) as { integrations: { id: string; password: string; apiKey: string }[] };
  // Any save: the integrations as they are, through the write queue.
  const save = async () => config.replaceIntegrations((await config.readConfigInternal()).integrations);

  it("reads a plaintext value as it is, and encrypts it on the next save", async () => {
    expect((await config.readConfigInternal()).integrations[0].password).toBe("hunter2");
    expect(await credentialStatus(await config.readConfigOnDisk())).toMatchObject({ source: "file", plaintext: 1, encrypted: 0 });
    await save();
    const file = await onDisk();
    expect(file.integrations[0].password.startsWith(ENC_PREFIX)).toBe(true);
    // A reference names a variable, not a secret: it stays readable.
    expect(file.integrations[1].apiKey).toBe("${SONARR_KEY}");
    expect((await config.readConfigInternal()).integrations[0].password).toBe("hunter2");
    expect(await credentialStatus(await config.readConfigOnDisk())).toMatchObject({ plaintext: 0, encrypted: 1, unreadable: 0 });
  });

  it("encrypts every kind of credential: alert channels, inbound webhooks, widgets", async () => {
    await fs.writeFile(
      configPath,
      YAML.dump({
        settings: {
          alerts: { channels: [{ id: "tg", type: "telegram", token: "tg-token", chatId: "42", smtp: { pass: "smtp-pw" } }] },
          webhooks: { radarr: { enabled: true, token: "hook-token" } },
        },
        widgets: [
          { id: "cal", type: "calendar", url: "https://cal.test/dav", username: "me", password: "cal-pw" },
          { id: "api", type: "api", url: "https://api.test", headers: [{ name: "Authorization", value: "Bearer abc" }] },
        ],
      })
    );
    await config.resaveConfig();
    const text = await fs.readFile(configPath, "utf8");
    for (const secret of ["tg-token", "smtp-pw", "hook-token", "cal-pw", "Bearer abc"]) expect(text).not.toContain(secret);
    // What isn't a credential stays readable: a chat id, a username.
    expect(text).toContain("chatId: '42'");
    expect(text).toContain("username: me");
    const read = await config.readConfigInternal();
    expect(read.settings.alerts.channels[0]).toMatchObject({ token: "tg-token", smtp: { pass: "smtp-pw" } });
    expect(read.settings.webhooks.radarr.token).toBe("hook-token");
    const widgets = Object.fromEntries(read.widgets.map((w) => [w.id, w]));
    expect(widgets.cal).toMatchObject({ password: "cal-pw" });
    expect(widgets.api).toMatchObject({ headers: [{ name: "Authorization", value: "Bearer abc" }] });
  });

  it("keeps the key beside config.yaml, readable by its owner alone", async () => {
    await save();
    expect(keyFilePath()).toBe(path.join(path.dirname(configPath), "config.key"));
    expect((await fs.stat(keyFilePath())).mode & 0o777).toBe(0o600);
  });

  it("keeps an unchanged value's ciphertext from save to save", async () => {
    await save();
    const first = (await onDisk()).integrations[0].password;
    await save();
    expect((await onDisk()).integrations[0].password).toBe(first);
  });

  it("keeps a value no key opens exactly as stored, and counts it", async () => {
    await save();
    const sealed = (await onDisk()).integrations[0].password;
    // The key lost: another one takes its place.
    await fs.writeFile(keyFilePath(), randomBytes(32).toString("base64url"));
    forgetConfigKeys();
    expect((await config.readConfigInternal()).integrations[0].password).toBe(sealed);
    await save();
    expect((await onDisk()).integrations[0].password).toBe(sealed);
    expect(await credentialStatus(await config.readConfigOnDisk())).toMatchObject({ unreadable: 1, encrypted: 0 });
  });

  it("uses CONFIG_KEY when set, and moves a value off the key file on the next save", async () => {
    await save();
    const underFile = (await onDisk()).integrations[0].password;
    vi.stubEnv("CONFIG_KEY", "a long random value from the environment");
    forgetConfigKeys();
    expect((await config.readConfigInternal()).integrations[0].password).toBe("hunter2");
    expect((await credentialStatus(await config.readConfigOnDisk())).source).toBe("env");
    await save();
    const underEnv = (await onDisk()).integrations[0].password;
    expect(underEnv).not.toBe(underFile);
    // Readable with the environment's key alone.
    await fs.rm(keyFilePath());
    forgetConfigKeys();
    expect((await config.readConfigInternal()).integrations[0].password).toBe("hunter2");
  });

  it("accepts the previous CONFIG_KEY while the new one takes over", async () => {
    vi.stubEnv("CONFIG_KEY", "the old key");
    forgetConfigKeys();
    await save();
    vi.stubEnv("CONFIG_KEY", "the new key");
    vi.stubEnv("CONFIG_KEY_PREVIOUS", "the old key");
    forgetConfigKeys();
    expect((await config.readConfigInternal()).integrations[0].password).toBe("hunter2");
    await save();
    vi.stubEnv("CONFIG_KEY_PREVIOUS", "");
    forgetConfigKeys();
    expect((await config.readConfigInternal()).integrations[0].password).toBe("hunter2");
  });

  it("rotates the key file, re-saving every value under the new key", async () => {
    await save();
    const oldKey = await fs.readFile(keyFilePath(), "utf8");
    const oldValue = (await onDisk()).integrations[0].password;
    await config.rotateConfigKey();
    expect(await fs.readFile(keyFilePath(), "utf8")).not.toBe(oldKey);
    expect((await onDisk()).integrations[0].password).not.toBe(oldValue);
    await expect(fs.access(`${keyFilePath()}.new`)).rejects.toThrow();
    forgetConfigKeys();
    expect((await config.readConfigInternal()).integrations[0].password).toBe("hunter2");
  });

  it("loses nothing when a rotation stops before its new key is moved into place", async () => {
    await save();
    await beginKeyRotation();
    await save();
    // The process ends here: config.yaml is under the new key, which is
    // still config.key.new.
    forgetConfigKeys();
    expect((await config.readConfigInternal()).integrations[0].password).toBe("hunter2");
  });

  it("won't rotate a key that comes from the environment", async () => {
    vi.stubEnv("CONFIG_KEY", "from the environment");
    forgetConfigKeys();
    await expect(config.rotateConfigKey()).rejects.toThrow(/CONFIG_KEY/);
  });
});
