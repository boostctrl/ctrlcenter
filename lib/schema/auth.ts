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

// An account (#423): the sign-in name `id` (a lowercase slug, stable), a
// display name, the role, and its own credential — a password hash and a
// TOTP enrollment, the shapes the single admin of 3.0 had. `groups` names
// the groups the account belongs to (the visibility rules of 3.1 read them);
// `mustChangePassword` makes the next sign-in set a new password first.
// Timestamps are ISO strings, "" when unknown.
export const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const userRoleSchema = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof userRoleSchema>;
export const userSchema = z.object({
  id: z
    .string()
    .regex(USER_ID_PATTERN, "A sign-in name is 1–64 lowercase letters, digits, dots, dashes or underscores"),
  name: z.string().max(80).default(""),
  role: userRoleSchema.default("member"),
  enabled: z.boolean().default(true),
  passwordHash: z.string().default(""),
  passwordSalt: z.string().default(""),
  totp: totpAuthSchema.default(totpAuthSchema.parse({})),
  groups: z.array(z.string()).max(64).default([]),
  mustChangePassword: z.boolean().default(false),
  createdAt: z.string().default(""),
  lastSignInAt: z.string().default(""),
});
export type User = z.infer<typeof userSchema>;

// The account the single admin of 3.0 became (#423): synthesised from the
// legacy fields below while `users` is empty, and the one ADMIN_PASSWORD
// stands in for while it has no stored password.
export const FOUNDING_ACCOUNT_ID = "admin";

// The accounts and their credentials (PBKDF2). Kept as a top-level key (not
// under settings) so it's never rendered into public pages.
export const authSchema = z.object({
  // The founding account's credential as 3.0 stored it. Empty means "no UI
  // password set" — sign-in falls back to the ADMIN_PASSWORD env var. Kept
  // in step with its entry in `users` on every write (lib/config/auth.ts),
  // so a 3.0.x build, which reads these and ignores `users`, still signs in
  // after a rollback. Read through lib/accounts.ts, never directly.
  passwordHash: z.string().default(""),
  passwordSalt: z.string().default(""),
  totp: totpAuthSchema.default(totpAuthSchema.parse({})),
  // Every account (#423). Empty in a file 3.0 wrote: the founding admin is
  // then the legacy credential above, as one account (lib/accounts.ts).
  users: z.array(userSchema).default([]),
});
export type AuthConfig = z.infer<typeof authSchema>;

// What the Users tab sends (#423): a new account with its first password,
// an edit to one, and a password reset. A group name is a slug like a
// sign-in name.
const groupList = z.array(z.string().regex(USER_ID_PATTERN, "A group name is lowercase letters, digits, dots, dashes or underscores")).max(64);
export const accountCreateSchema = z.object({
  id: userSchema.shape.id,
  name: z.string().trim().max(80).default(""),
  role: userRoleSchema.default("member"),
  groups: groupList.default([]),
  password: z.string().min(12, "A password must be at least 12 characters"),
  // Make the first sign-in set a new password: on by default.
  mustChangePassword: z.boolean().default(true),
});
export const accountUpdateSchema = z.object({
  name: z.string().trim().max(80).optional(),
  role: userRoleSchema.optional(),
  groups: groupList.optional(),
  enabled: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
});
export const accountPasswordResetSchema = z.object({
  password: z.string().min(12, "A password must be at least 12 characters"),
});

// Request bodies for the 2FA routes.
export const totpActivateSchema = z.object({ code: z.string() });
export const totpDisableSchema = z.object({ code: z.string() });

// Change-password (POST /api/password).
export const passwordChangeSchema = z.object({
  current: z.string(),
  next: z.string().min(12, "New password must be at least 12 characters"),
});

// The idle timeout (PATCH /api/sessions, #365): a session unused for this
// many hours ends. Bounds mirror lib/sessions.ts.
export const sessionSettingsSchema = z.object({
  idleHours: z
    .number()
    .int()
    .min(1, "Idle timeout must be at least 1 hour")
    .max(24 * 7, "Idle timeout can be at most 7 days"),
});
