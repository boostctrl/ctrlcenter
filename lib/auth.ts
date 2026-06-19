import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "homepage_admin_session";
const SESSION_DURATION = "7d";

// Edge middleware can't use Node's `crypto` module, so we derive the JWT
// signing key with Web Crypto (available in both Node and the Edge runtime).
async function getSecretKey(): Promise<Uint8Array> {
  const base = process.env.ADMIN_PASSWORD ?? "";
  const data = new TextEncoder().encode(base);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

export function verifyPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected || typeof password !== "string") return false;
  const a = new TextEncoder().encode(password);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function createSessionToken(): Promise<string> {
  const key = await getSecretKey();
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(key);
}

export async function verifySessionToken(
  token: string | undefined
): Promise<boolean> {
  if (!token) return false;
  try {
    const key = await getSecretKey();
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}
