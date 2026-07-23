// Storage and verification of TOTP recovery codes (#198). Codes are hashed
// with the same PBKDF2 as the admin password (lib/auth.ts), so a leaked
// config.yaml never exposes usable codes. Server-side only.

import { hashPassword, verifyPasswordHash } from "./auth";
import { normalizeRecoveryCode } from "./totp";
import type { TotpAuth } from "./schema";

type StoredCode = TotpAuth["recoveryCodes"][number];

// Hash each plaintext recovery code for storage. Normalized first so the
// stored form matches however the admin later types it back.
export async function hashRecoveryCodes(codes: string[]): Promise<StoredCode[]> {
  return Promise.all(
    codes.map(async (code) => hashPassword(normalizeRecoveryCode(code)))
  );
}

// Check a submitted recovery code against the stored hashes. On a match,
// return the remaining codes (with the used one removed) so the caller can
// persist the consumption — a recovery code works exactly once.
// Recovery codes normalize to exactly 10 characters (two groups of five).
const RECOVERY_CODE_LENGTH = 10;

export async function verifyRecoveryCode(
  submitted: string,
  stored: StoredCode[]
): Promise<{ ok: boolean; remaining: StoredCode[] }> {
  const normalized = normalizeRecoveryCode(submitted);
  // Anything that isn't a recovery-code-shaped string (e.g. a mistyped 6-digit
  // TOTP code) can't match — skip the per-code PBKDF2 so a wrong code doesn't
  // cost ten hashes.
  if (normalized.length !== RECOVERY_CODE_LENGTH) {
    return { ok: false, remaining: stored };
  }
  for (let i = 0; i < stored.length; i++) {
    if (await verifyPasswordHash(normalized, stored[i].hash, stored[i].salt)) {
      return { ok: true, remaining: stored.filter((_, idx) => idx !== i) };
    }
  }
  return { ok: false, remaining: stored };
}
