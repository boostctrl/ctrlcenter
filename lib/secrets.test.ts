import { describe, it, expect, afterEach } from "vitest";
import { resolveSecret, withoutEnvSecrets, isSavedUrl, expandEnvRefs } from "./secrets";

describe("resolveSecret", () => {
  afterEach(() => {
    delete process.env.CTRLCENTER_TEST_KEY;
  });

  it("prefers the env var over the stored value", () => {
    process.env.CTRLCENTER_TEST_KEY = "from-env";
    expect(resolveSecret("CTRLCENTER_TEST_KEY", "stored")).toBe("from-env");
    expect(resolveSecret("CTRLCENTER_UNSET_KEY", "stored")).toBe("stored");
  });

  it("ignores env secrets inside withoutEnvSecrets, across awaits", async () => {
    process.env.CTRLCENTER_TEST_KEY = "from-env";
    const seen = await withoutEnvSecrets(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return resolveSecret("CTRLCENTER_TEST_KEY", "typed-in");
    });
    expect(seen).toBe("typed-in");
    // The scope ends with the callback.
    expect(resolveSecret("CTRLCENTER_TEST_KEY", "typed-in")).toBe("from-env");
  });
});

describe("isSavedUrl", () => {
  it("matches the saved URL modulo case, whitespace and trailing slashes", () => {
    expect(isSavedUrl(" HTTP://Sonarr.lan:8989/ ", "http://sonarr.lan:8989")).toBe(true);
  });

  it("rejects any other URL, and an empty saved URL", () => {
    expect(isSavedUrl("http://evil.example", "http://sonarr.lan:8989")).toBe(false);
    expect(isSavedUrl("http://sonarr.lan:8989/x", "http://sonarr.lan:8989")).toBe(false);
    expect(isSavedUrl("", "")).toBe(false);
  });
});

describe("expandEnvRefs", () => {
  afterEach(() => {
    delete process.env.CTRLCENTER_TEST_KEY;
  });

  it("expands a reference, and an unset one to nothing", () => {
    process.env.CTRLCENTER_TEST_KEY = "k3y";
    expect(expandEnvRefs("Bearer ${CTRLCENTER_TEST_KEY}")).toBe("Bearer k3y");
    expect(expandEnvRefs("${CTRLCENTER_UNSET_KEY}")).toBe("");
  });

  it("never expands the app's own credentials (#378)", () => {
    process.env.CTRLCENTER_TEST_KEY = "k3y";
    const env = { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, SESSION_SECRET: process.env.SESSION_SECRET };
    process.env.ADMIN_PASSWORD = "hunter2";
    process.env.SESSION_SECRET = "signing-key";
    try {
      expect(expandEnvRefs("https://x.example/?p=${ADMIN_PASSWORD}&s=${SESSION_SECRET}&k=${CTRLCENTER_TEST_KEY}")).toBe(
        "https://x.example/?p=&s=&k=k3y"
      );
    } finally {
      for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("expands nothing inside withoutEnvSecrets", async () => {
    process.env.CTRLCENTER_TEST_KEY = "k3y";
    expect(await withoutEnvSecrets(async () => expandEnvRefs("${CTRLCENTER_TEST_KEY}"))).toBe("");
  });
});
