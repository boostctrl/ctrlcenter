// The accounts behind sign-in (#423), read from config.auth.
//
// A file 3.0 wrote lists no accounts: its one admin is the legacy credential
// fields, and reads here as the founding account `admin`. Once anything
// about an account is written (lib/config/auth.ts) the list is
// materialised, with the founding account's credential mirrored back into
// the legacy fields for a 3.0.x rollback. Nothing else reads those fields.
import { FOUNDING_ACCOUNT_ID, userSchema, type AuthConfig, type User } from "./schema/auth";

// Every account, in the stored order.
export function accountsOf(auth: AuthConfig): User[] {
  return auth.users.length > 0 ? auth.users : [foundingFromLegacy(auth)];
}

// The founding admin as the legacy fields describe it.
export function foundingFromLegacy(auth: AuthConfig): User {
  return userSchema.parse({
    id: FOUNDING_ACCOUNT_ID,
    role: "admin",
    passwordHash: auth.passwordHash,
    passwordSalt: auth.passwordSalt,
    totp: auth.totp,
  });
}

// The account with this sign-in name, or null.
export function findAccount(auth: AuthConfig, id: string): User | null {
  return accountsOf(auth).find((u) => u.id === id) ?? null;
}

// The founding account: `admin`, else the first admin, else the first
// account listed (a list never has none).
export function foundingAccount(auth: AuthConfig): User {
  const all = accountsOf(auth);
  return all.find((u) => u.id === FOUNDING_ACCOUNT_ID) ?? all.find((u) => u.role === "admin") ?? all[0];
}

// Whether ADMIN_PASSWORD stands in for this account's password: only the
// founding admin, and only while it has no stored one (the 3.0 rule).
export function usesEnvPassword(account: Pick<User, "id" | "passwordHash">): boolean {
  return account.id === FOUNDING_ACCOUNT_ID && !account.passwordHash && Boolean(process.env.ADMIN_PASSWORD);
}

// Whether the account can sign in with a password at all.
export function passwordConfigured(account: Pick<User, "id" | "passwordHash">): boolean {
  return Boolean(account.passwordHash) || usesEnvPassword(account);
}

// Whether the account may act as an admin: the role, and not disabled.
export function isAdminAccount(account: Pick<User, "role" | "enabled">): boolean {
  return account.enabled && account.role === "admin";
}
