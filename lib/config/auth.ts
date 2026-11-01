// The accounts' credentials and TOTP enrollments (#290 split, #423): every
// write to config.auth goes through mutateAccount below.
import { FOUNDING_ACCOUNT_ID, totpAuthSchema, userSchema, type TotpAuth, type User } from "../schema/auth";
import { accountsOf } from "../accounts";
import { mutate, NotFoundError } from "./store";

// Edit one account inside the write queue. The first write of any account
// materialises `users` from the legacy fields (a file 3.0 wrote lists none);
// the founding account's credential is then also written back to those
// fields, so a 3.0.x build, which reads them and ignores `users`, signs in
// after a rollback. `fn` gets a copy to edit and its return value comes
// back; throwing inside it writes nothing.
async function mutateAccount<T>(id: string, fn: (account: User) => T): Promise<T> {
  return mutate((config) => {
    const users = accountsOf(config.auth).map((u) => ({
      ...u,
      totp: { ...u.totp, recoveryCodes: [...u.totp.recoveryCodes] },
      groups: [...u.groups],
    }));
    const account = users.find((u) => u.id === id);
    if (!account) throw new NotFoundError(`No account "${id}"`);
    const result = fn(account);
    config.auth = {
      ...config.auth,
      users,
      ...(account.id === FOUNDING_ACCOUNT_ID
        ? { passwordHash: account.passwordHash, passwordSalt: account.passwordSalt, totp: account.totp }
        : {}),
    };
    return result;
  });
}

// A new account, in full (the caller hashes its password first). Refused
// when the sign-in name is taken; a file 3.0 wrote gets its list
// materialised with the founding admin ahead of the newcomer.
export class AccountExistsError extends Error {}
export async function addAccount(user: User): Promise<void> {
  await mutate((config) => {
    const users = accountsOf(config.auth);
    if (users.some((u) => u.id === user.id)) throw new AccountExistsError(`An account "${user.id}" already exists`);
    config.auth = { ...config.auth, users: [...users, userSchema.parse(user)] };
  });
}

// The moment an account signed in, for the Users list.
export async function noteSignIn(id: string, at = new Date()): Promise<void> {
  await mutateAccount(id, (account) => {
    account.lastSignInAt = at.toISOString();
  });
}

// An account's new password (hash and salt from lib/auth.ts hashPassword).
// Clears a must-change flag: the change is what it asked for.
export async function setAccountPassword(id: string, passwordHash: string, passwordSalt: string): Promise<void> {
  await mutateAccount(id, (account) => {
    account.passwordHash = passwordHash;
    account.passwordSalt = passwordSalt;
    account.mustChangePassword = false;
  });
}

// An admin's reset of another account's password (#423): stored like a
// change, and the account must pick its own at its next sign-in.
export async function resetAccountPassword(id: string, passwordHash: string, passwordSalt: string): Promise<void> {
  await mutateAccount(id, (account) => {
    account.passwordHash = passwordHash;
    account.passwordSalt = passwordSalt;
    account.mustChangePassword = true;
  });
}

// The parts of an account the Users tab edits (#423). The founding admin
// stays an enabled admin whatever is asked, so nobody can lock every admin
// out of the portal.
export type AccountPatch = Partial<Pick<User, "name" | "role" | "groups" | "enabled" | "mustChangePassword">>;
export async function updateAccount(id: string, patch: AccountPatch): Promise<User> {
  return mutateAccount(id, (account) => {
    if (patch.name !== undefined) account.name = patch.name;
    if (patch.groups !== undefined) account.groups = [...patch.groups];
    if (patch.mustChangePassword !== undefined) account.mustChangePassword = patch.mustChangePassword;
    if (account.id !== FOUNDING_ACCOUNT_ID) {
      if (patch.role !== undefined) account.role = patch.role;
      if (patch.enabled !== undefined) account.enabled = patch.enabled;
    }
    return { ...account, totp: { ...account.totp }, groups: [...account.groups] };
  });
}

// Remove an account (#423); never the founding admin. Its sessions are the
// caller's to end (lib/sessions revokeSessions).
export async function deleteAccount(id: string): Promise<void> {
  if (id === FOUNDING_ACCOUNT_ID) throw new Error("The founding admin account can't be removed");
  await mutate((config) => {
    const users = accountsOf(config.auth);
    if (!users.some((u) => u.id === id)) throw new NotFoundError(`No account "${id}"`);
    config.auth = { ...config.auth, users: users.filter((u) => u.id !== id) };
  });
}

// The founding admin's password: what the first-run setup sets.
export async function setPasswordHash(passwordHash: string, passwordSalt: string): Promise<void> {
  await setAccountPassword(FOUNDING_ACCOUNT_ID, passwordHash, passwordSalt);
}

// --- TOTP second factor (#198), all mutations of an account's totp ---

// Stash a freshly generated secret mid-enrollment. Not active until a code
// verifies it (confirmTotpEnrollment); overwriting a prior pending secret is
// fine.
export async function setTotpPendingSecret(id: string, pendingSecret: string): Promise<void> {
  await mutateAccount(id, (account) => {
    account.totp = { ...account.totp, pendingSecret };
  });
}

export class TotpStateError extends Error {
  constructor(
    message: string,
    // What the route answers: 409 when the factor is already on, 400 when
    // the enrollment the code was checked against is gone.
    public readonly status: 400 | 409
  ) {
    super(message);
  }
}

// Turn 2FA on with `secret` and these recovery codes, whatever the state.
export async function activateTotp(
  id: string,
  secret: string,
  recoveryCodes: TotpAuth["recoveryCodes"]
): Promise<void> {
  await mutateAccount(id, (account) => {
    account.totp = { enabled: true, secret, pendingSecret: "", recoveryCodes };
  });
}

// What the activation route does (#399): turn 2FA on with the secret the
// code was checked against, which must still be the pending one, with the
// checks inside the write queue, so two activations arriving together can't
// both pass a check made outside it and replace a live secret.
export async function confirmTotpEnrollment(
  id: string,
  secret: string,
  recoveryCodes: TotpAuth["recoveryCodes"]
): Promise<void> {
  await mutateAccount(id, (account) => {
    if (account.totp.enabled) {
      throw new TotpStateError(
        "Two-factor authentication is already on — turn it off first to set up a new authenticator.",
        409
      );
    }
    if (account.totp.pendingSecret !== secret) {
      throw new TotpStateError("Start setup again — no enrollment in progress.", 400);
    }
    account.totp = { enabled: true, secret, pendingSecret: "", recoveryCodes };
  });
}

// Turn 2FA off and clear every trace of it.
export async function disableTotp(id: string): Promise<void> {
  await mutateAccount(id, (account) => {
    account.totp = totpAuthSchema.parse({});
  });
}

// Spend one recovery code, identified by its stored hash, inside the write
// queue: true if it was still there (and is now gone), false if a concurrent
// login already spent it. The caller verifies the code first (PBKDF2, outside
// the queue); this makes the check-and-remove atomic.
export async function spendTotpRecoveryCode(id: string, hash: string): Promise<boolean> {
  return mutateAccount(id, (account) => {
    const codes = account.totp.recoveryCodes;
    if (!codes.some((c) => c.hash === hash)) return false;
    account.totp = { ...account.totp, recoveryCodes: codes.filter((c) => c.hash !== hash) };
    return true;
  });
}
