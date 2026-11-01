import { describe, it, expect, afterEach, vi } from "vitest";
import { authSchema, userSchema } from "./schema/auth";
import {
  accountsOf,
  findAccount,
  foundingAccount,
  foundingFromLegacy,
  isAdminAccount,
  passwordConfigured,
  usesEnvPassword,
} from "./accounts";

// A file 3.0 wrote: one admin in the legacy fields, no list.
const legacy = authSchema.parse({
  passwordHash: "h",
  passwordSalt: "s",
  totp: { enabled: true, secret: "SECRET" },
});

describe("accounts (#423)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads a 3.0 file's single admin as the founding account", () => {
    const [admin, ...rest] = accountsOf(legacy);
    expect(rest).toEqual([]);
    expect(admin).toMatchObject({ id: "admin", role: "admin", enabled: true, passwordHash: "h", passwordSalt: "s" });
    expect(admin.totp.secret).toBe("SECRET");
    expect(foundingAccount(legacy)).toEqual(foundingFromLegacy(legacy));
    expect(findAccount(legacy, "admin")?.id).toBe("admin");
    expect(findAccount(legacy, "nobody")).toBeNull();
  });

  it("lists the stored accounts as they are once the list exists, over the legacy fields", () => {
    const member = userSchema.parse({ id: "sam", role: "member", passwordHash: "m", passwordSalt: "ms" });
    const auth = authSchema.parse({
      ...legacy,
      users: [userSchema.parse({ id: "admin", role: "admin", passwordHash: "h2", passwordSalt: "s2" }), member],
    });
    expect(accountsOf(auth).map((u) => u.id)).toEqual(["admin", "sam"]);
    expect(foundingAccount(auth).passwordHash).toBe("h2");
    expect(findAccount(auth, "sam")).toEqual(member);
  });

  it("falls back to the first admin, then the first account, as the founding one", () => {
    const auth = authSchema.parse({ users: [{ id: "sam", role: "member" }, { id: "root", role: "admin" }] });
    expect(foundingAccount(auth).id).toBe("root");
    expect(foundingAccount(authSchema.parse({ users: [{ id: "sam", role: "member" }] })).id).toBe("sam");
  });

  it("lets ADMIN_PASSWORD stand in only for a founding admin without a stored password", () => {
    vi.stubEnv("ADMIN_PASSWORD", "env-secret");
    expect(usesEnvPassword({ id: "admin", passwordHash: "" })).toBe(true);
    expect(usesEnvPassword({ id: "admin", passwordHash: "h" })).toBe(false);
    expect(usesEnvPassword({ id: "sam", passwordHash: "" })).toBe(false);
    expect(passwordConfigured({ id: "admin", passwordHash: "" })).toBe(true);
    expect(passwordConfigured({ id: "sam", passwordHash: "" })).toBe(false);
    expect(passwordConfigured({ id: "sam", passwordHash: "h" })).toBe(true);
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(passwordConfigured({ id: "admin", passwordHash: "" })).toBe(false);
  });

  it("counts only an enabled admin as an admin", () => {
    expect(isAdminAccount({ role: "admin", enabled: true })).toBe(true);
    expect(isAdminAccount({ role: "admin", enabled: false })).toBe(false);
    expect(isAdminAccount({ role: "member", enabled: true })).toBe(false);
  });

  it("refuses a sign-in name that isn't a slug", () => {
    expect(userSchema.safeParse({ id: "Sam" }).success).toBe(false);
    expect(userSchema.safeParse({ id: "sam smith" }).success).toBe(false);
    expect(userSchema.safeParse({ id: "" }).success).toBe(false);
    expect(userSchema.safeParse({ id: "sam.smith-2_x" }).success).toBe(true);
  });
});
