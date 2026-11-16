// Signing in through another service (#504): an OpenID Connect provider
// (Nextcloud's OIDC Identity Provider app, Authentik, Authelia, Pocket ID,
// …) beside the password form. Every way in maps onto the accounts that
// exist (#423) — matched by sign-in name — and adds the provider's groups
// that are on the groups list (#505) to the session; nothing else about
// who sees what changes.
//
// Stored under settings, private wholesale from a visitor; the client
// secret is a credential (#382), so the admin's forms get a placeholder, a
// backup without secrets leaves it out, and config.yaml holds it encrypted
// (#370). It can also come from CTRLCENTER_OIDC_CLIENT_SECRET, which wins.
// Edited only through /api/sign-in, which asks for a recent confirmation:
// it opens a way in.
import { z } from "zod";
import { secretFields } from "./meta";

// What the provider's claims are read for: the sign-in name, the groups.
export const OIDC_DEFAULT_SCOPES = "openid profile email groups";

export const oidcSchema = z.object({
  enabled: z.boolean().catch(false).default(false),
  // The button says "Sign in with <label>".
  label: z.string().max(40).catch("").default(""),
  // The issuer, or the address of its discovery document (…/.well-known/
  // openid-configuration) when the issuer's own one isn't reachable.
  issuer: z.string().max(500).catch("").default(""),
  clientId: z.string().max(200).catch("").default(""),
  clientSecret: z
    .string()
    .max(500)
    .catch("")
    .default("")
    .register(secretFields, { redact: "blank", credential: true }),
  scopes: z.string().max(200).catch(OIDC_DEFAULT_SCOPES).default(OIDC_DEFAULT_SCOPES),
  // The claim that names the account, and the one listing the groups.
  usernameClaim: z.string().max(60).catch("preferred_username").default("preferred_username"),
  groupsClaim: z.string().max(60).catch("groups").default("groups"),
  // A name with no account here: refused, or a new member made for it.
  createAccounts: z.boolean().catch(false).default(false),
  // The provider asks for a second factor of everyone, so its sign-in
  // counts as two-factor here too even when it doesn't say so (Nextcloud's
  // app sends no `amr`).
  enforcesTwoFactor: z.boolean().catch(false).default(false),
  // Signing out of CtrlCenter also signs out of the provider.
  endProviderSession: z.boolean().catch(false).default(false),
});
export type OidcConfig = z.infer<typeof oidcSchema>;

export const signInSchema = z.object({
  oidc: oidcSchema.default(oidcSchema.parse({})),
});
export type SignInConfig = z.infer<typeof signInSchema>;

// What /api/sign-in takes: the provider's settings whole.
export const signInUpdateSchema = z.object({
  oidc: z.object({
    enabled: z.boolean(),
    label: z.string().trim().max(40),
    issuer: z
      .string()
      .trim()
      .max(500)
      .refine((v) => v === "" || /^https?:\/\//i.test(v), "The issuer must start with http(s)://"),
    clientId: z.string().trim().max(200),
    clientSecret: z.string().max(500),
    scopes: z.string().trim().max(200),
    usernameClaim: z.string().trim().min(1).max(60),
    groupsClaim: z.string().trim().max(60),
    createAccounts: z.boolean(),
    enforcesTwoFactor: z.boolean(),
    endProviderSession: z.boolean(),
  }),
});
