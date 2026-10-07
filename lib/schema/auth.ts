// Admin credential, TOTP second factor, and their request bodies.
import { z } from "zod";

// Opt-in TOTP second factor (#198). All server-side under `auth`, so stripAuth
// keeps it out of every public/exported config (never in a browser after
// enrollment). `secret` is the active base32 TOTP secret; `pendingSecret`
// holds a not-yet-confirmed secret mid-enrollment; `recoveryCodes` are the
// PBKDF2 hashes of the unused one-time codes. `enabled` is the single flag the
// login flow and the admin UI read.
export const totpRecoveryCodeSchema = z.object({
  hash: z.string(),
  salt: z.string(),
});
export const totpAuthSchema = z.object({
  enabled: z.boolean().default(false),
  secret: z.string().default(""),
  pendingSecret: z.string().default(""),
  recoveryCodes: z.array(totpRecoveryCodeSchema).default([]),
});
export type TotpAuth = z.infer<typeof totpAuthSchema>;

// Optional stored admin credential (PBKDF2). Empty means "no UI password set"
// — login falls back to the ADMIN_PASSWORD env var. Kept as a top-level key
// (not under settings) so it's never rendered into public pages.
export const authSchema = z.object({
  passwordHash: z.string().default(""),
  passwordSalt: z.string().default(""),
  totp: totpAuthSchema.default(totpAuthSchema.parse({})),
});

// Request bodies for the 2FA routes.
export const totpActivateSchema = z.object({ code: z.string() });
export const totpDisableSchema = z.object({ code: z.string() });

// Change-password (POST /api/password).
export const passwordChangeSchema = z.object({
  current: z.string(),
  next: z.string().min(8, "New password must be at least 8 characters"),
});
