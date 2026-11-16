// Passkeys (#537): WebAuthn through SimpleWebAuthn. An account adds one
// from its own page; anyone signs in with one from the sign-in form, the
// browser offering the passkeys it holds for this host. User verification
// (a PIN, a fingerprint) is required, so a passkey sign-in counts as two
// factors on its own. A passkey is bound to the host it was made on — the
// relying party is the address the browser shows — so an instance reached
// under two names has passkeys for each.
//
// The challenge for each ceremony rides in a signed cookie for five
// minutes, as the provider sign-in's flow does (lib/oidc.ts).
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { NextRequest } from "next/server";
import { publicOrigin } from "./oidc";
import type { Passkey, User } from "./schema/auth";

export const PASSKEY_CHALLENGE_TTL = 300;
export const REGISTER_COOKIE = "ctrlcenter_passkey_add";
export const SIGNIN_COOKIE = "ctrlcenter_passkey";

// The relying party: the host the browser shows, without a port, and the
// origin it must have come from.
export function relyingParty(request: NextRequest): { rpId: string; origin: string } {
  const origin = publicOrigin(request);
  return { rpId: new URL(origin).hostname, origin };
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const bytes = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

// What the browser needs to make a passkey for this account here: never one
// it already has for this host.
export async function registrationOptions(request: NextRequest, account: User, siteTitle: string) {
  const { rpId } = relyingParty(request);
  return generateRegistrationOptions({
    rpName: siteTitle || "CtrlCenter",
    rpID: rpId,
    userName: account.id,
    userID: new TextEncoder().encode(account.id),
    userDisplayName: account.name || account.id,
    attestationType: "none",
    excludeCredentials: account.passkeys.filter((p) => p.rpId === rpId).map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

// The new passkey, checked against the challenge this ceremony was given,
// or null when the browser's answer doesn't hold.
export async function verifyRegistration(
  request: NextRequest,
  response: RegistrationResponseJSON,
  challenge: string,
  name: string,
  now = Date.now()
): Promise<Passkey | null> {
  const { rpId, origin } = relyingParty(request);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    requireUserVerification: true,
  });
  if (!result.verified) return null;
  const { credential } = result.registrationInfo;
  return {
    id: credential.id,
    publicKey: b64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    rpId,
    name: name.trim().slice(0, 60) || "Passkey",
    createdAt: now,
    lastUsedAt: null,
  };
}

// What the browser needs to offer its passkeys for this host: any of them,
// so it can show the person which accounts it has.
export async function authenticationOptions(request: NextRequest) {
  return generateAuthenticationOptions({ rpID: relyingParty(request).rpId, userVerification: "required" });
}

// The account and passkey the browser's answer is from, when it holds: the
// passkey made on this host, its signature over this ceremony's challenge,
// and a counter that hasn't gone backwards. The new counter comes back to
// be stored. Every account holding the id is tried until one's key checks
// out (#557): a credential id is one account's alone now, but a file 3.3.0
// wrote may hold the same id twice, and the first holder mustn't block the
// one whose key signed.
export async function verifyAuthentication(
  request: NextRequest,
  response: AuthenticationResponseJSON,
  challenge: string,
  accounts: readonly User[]
): Promise<{ account: User; passkey: Passkey; counter: number } | null> {
  const { rpId, origin } = relyingParty(request);
  for (const account of accounts) {
    const passkey = account.passkeys.find((p) => p.id === response.id && p.rpId === rpId);
    if (!passkey) continue;
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
        credential: { id: passkey.id, publicKey: bytes(passkey.publicKey), counter: passkey.counter, transports: passkey.transports },
        requireUserVerification: true,
      });
    } catch {
      continue;
    }
    if (result.verified) return { account, passkey, counter: result.authenticationInfo.newCounter };
  }
  return null;
}
