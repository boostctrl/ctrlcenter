// The admin credential and TOTP enrollment (#290 split).
import { totpAuthSchema, type TotpAuth } from "../schema";
import { mutate } from "./store";

export async function setPasswordHash(
  passwordHash: string,
  passwordSalt: string
): Promise<void> {
  await mutate((config) => {
    // Spread the existing auth so a password change preserves the TOTP
    // enrollment (#198) instead of wiping it.
    config.auth = { ...config.auth, passwordHash, passwordSalt };
  });
}

// --- TOTP second factor (#198), all mutations of config.auth.totp ---

// Stash a freshly generated secret mid-enrollment. Not active until a code
// verifies it (activateTotp); overwriting a prior pending secret is fine.
export async function setTotpPendingSecret(pendingSecret: string): Promise<void> {
  await mutate((config) => {
    config.auth.totp = { ...config.auth.totp, pendingSecret };
  });
}

// Turn the pending secret into the active one and store the (hashed) recovery
// codes — called only after the enrollment code verified.
export async function activateTotp(
  secret: string,
  recoveryCodes: TotpAuth["recoveryCodes"]
): Promise<void> {
  await mutate((config) => {
    config.auth.totp = {
      enabled: true,
      secret,
      pendingSecret: "",
      recoveryCodes,
    };
  });
}

// Turn 2FA off and clear every trace of it.
export async function disableTotp(): Promise<void> {
  await mutate((config) => {
    config.auth.totp = totpAuthSchema.parse({});
  });
}

// Spend one recovery code, identified by its stored hash, inside the write
// queue: true if it was still there (and is now gone), false if a concurrent
// login already spent it. The caller verifies the code first (PBKDF2, outside
// the queue); this makes the check-and-remove atomic.
export async function spendTotpRecoveryCode(hash: string): Promise<boolean> {
  return mutate((config) => {
    const codes = config.auth.totp.recoveryCodes;
    if (!codes.some((c) => c.hash === hash)) return false;
    config.auth.totp = {
      ...config.auth.totp,
      recoveryCodes: codes.filter((c) => c.hash !== hash),
    };
    return true;
  });
}
