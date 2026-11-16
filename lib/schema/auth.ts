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
// `mustChangePassword` makes the next sign-in set a new password first, and
// `requireTwoFactor` keeps the account on its own page until it has a second
// factor, and from turning that factor off (#449).
// Timestamps are ISO strings, "" when unknown.
export const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// A passkey (#537): the credential's id and public key (base64url), its
// signature counter, how the browser reaches it, the host it was made on
// (a passkey works there only), the name its owner gave it, and when it was
// made and last used (epoch ms). Nothing in it opens a way in by itself.
export const MAX_PASSKEYS = 20;
export const passkeySchema = z.object({
  id: z.string().min(1).max(1024),
  publicKey: z.string().min(1).max(2048),
  counter: z.number().int().min(0).catch(0).default(0),
  transports: z.array(z.string().max(20)).max(10).catch([]).default([]),
  rpId: z.string().min(1).max(253),
  name: z.string().max(60).catch("").default(""),
  createdAt: z.number().catch(0).default(0),
  lastUsedAt: z.number().nullable().catch(null).default(null),
});
export type Passkey = z.infer<typeof passkeySchema>;

// The sign-in provider identity an account is connected to (#555): the
// issuer and the provider's own stable id for the person (`sub`), which a
// provider sign-in and its confirmations are matched on — never the
// username, which some providers let people choose. `name` is the username
// it had when connected, for display; `linkedAt` epoch ms.
export const providerLinkSchema = z.object({
  iss: z.string().min(1).max(500),
  sub: z.string().min(1).max(255),
  name: z.string().max(80).catch("").default(""),
  linkedAt: z.number().catch(0).default(0),
});
export type ProviderLink = z.infer<typeof providerLinkSchema>;
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
  requireTwoFactor: z.boolean().default(false),
  createdAt: z.string().default(""),
  lastSignInAt: z.string().default(""),
  // The provider identity it is connected to (#555), or none.
  provider: providerLinkSchema.nullable().catch(null).default(null),
  // Its passkeys (#537); a malformed one is dropped on read.
  passkeys: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((list) => list.flatMap((p) => {
      const r = passkeySchema.safeParse(p);
      return r.success ? [r.data] : [];
    }).slice(0, MAX_PASSKEYS)),
});
export type User = z.infer<typeof userSchema>;

// The account the single admin of 3.0 became (#423): synthesised from the
// legacy fields below while `users` is empty, and the one ADMIN_PASSWORD
// stands in for while it has no stored password.
export const FOUNDING_ACCOUNT_ID = "admin";

// The groups accounts belong to and items are shared with (#505), as a list
// of names kept in one place: a group can exist before anyone is in it, and
// is renamed or removed everywhere at once (lib/account-groups.ts). A name
// that isn't a slug is dropped on read, so a hand edit can't fail the load.
export const MAX_ACCOUNT_GROUPS = 256;
export const groupNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(USER_ID_PATTERN, "A group name is 1–64 lowercase letters, digits, dots, dashes or underscores");
const storedGroups = z
  .array(z.unknown())
  .catch([])
  .transform((a) =>
    [...new Set(a.filter((s): s is string => typeof s === "string" && USER_ID_PATTERN.test(s)))].slice(0, MAX_ACCOUNT_GROUPS)
  );

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
  // The managed list of groups (#505). Groups an account or a shared item
  // names count too (accountGroups), so a file from before the list loses
  // none.
  groups: storedGroups.default([]),
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
  requireTwoFactor: z.boolean().default(false),
});
export const accountUpdateSchema = z.object({
  name: z.string().trim().max(80).optional(),
  role: userRoleSchema.optional(),
  groups: groupList.optional(),
  enabled: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  requireTwoFactor: z.boolean().optional(),
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
