import type { User } from "./schema/auth";
import { verifyEnvPassword, verifyPasswordHash } from "./auth";
import { usesEnvPassword } from "./accounts";
import { spendTotpRecoveryCode } from "./config";
import { verifyTotpOnce } from "./totp";
import { verifyRecoveryCode } from "./recovery-codes";

// The one credential check (#366), per account (#423): the password (a
// stored hash, else ADMIN_PASSWORD for the founding admin) and, with the
// second factor on, a current authenticator code or an unused recovery code
// (spent on success). Sign-in and the step-up confirmation both run this,
// so they can't drift apart. A disabled account fails like a wrong password.
export type CredentialResult =
  | { ok: true }
  // The password was wrong (never says which part).
  | { ok: false; reason: "password" }
  // The password was right; a code is needed and none was given.
  | { ok: false; reason: "totp-required" }
  // The password was right; the code didn't match (or was already spent).
  | { ok: false; reason: "code" };

export async function verifyCredentials(
  account: User,
  password: unknown,
  totpCode: unknown
): Promise<CredentialResult> {
  if (typeof password !== "string" || !account.enabled) return { ok: false, reason: "password" };
  const ok = account.passwordHash
    ? await verifyPasswordHash(password, account.passwordHash, account.passwordSalt)
    : usesEnvPassword(account) && verifyEnvPassword(password);
  if (!ok) return { ok: false, reason: "password" };
  if (!account.totp.enabled) return { ok: true };
  const code = typeof totpCode === "string" ? totpCode.trim() : "";
  if (code === "") return { ok: false, reason: "totp-required" };
  if (await verifyTotpOnce(account.totp.secret, code)) return { ok: true };
  // Not a valid time code — try it as a one-time recovery code, spending it
  // on success so it can't be reused.
  const match = await verifyRecoveryCode(code, account.totp.recoveryCodes);
  if (match.matched && (await spendTotpRecoveryCode(account.id, match.matched.hash))) return { ok: true };
  return { ok: false, reason: "code" };
}
