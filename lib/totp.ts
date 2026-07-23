// TOTP (RFC 6238) for the opt-in admin second factor (#198). Built on Web
// Crypto — HMAC-SHA1, the algorithm every authenticator app defaults to — so
// it needs no native/third-party crypto, matching how password hashing is
// done (lib/auth.ts). Server-side only; the secret never reaches the browser
// after enrollment, and stripAuth keeps it out of every public/exported
// config (the #157 precedent).

const PERIOD_SECONDS = 30;
const DIGITS = 6;
// Accept the adjacent time steps too, so a code entered a few seconds either
// side of a boundary — or with a slightly wrong device clock — still verifies.
const DEFAULT_SKEW_STEPS = 1;

// --- base32 (RFC 4648, no padding) — the encoding authenticator apps expect ---

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  // Tolerate the spaces/lowercase/padding a human might paste.
  const clean = input.toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue; // skip any stray character rather than throw
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// A fresh 160-bit secret (20 bytes), the RFC 4226 recommended length, as
// base32 for the otpauth URI and manual entry.
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

// 8-byte big-endian counter for HOTP.
function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // Split across two 32-bit halves — a single << would overflow past 2^31.
  let high = Math.floor(counter / 2 ** 32);
  let low = counter >>> 0;
  for (let i = 7; i >= 4; i--) {
    buf[i] = low & 0xff;
    low = Math.floor(low / 256);
  }
  for (let i = 3; i >= 0; i--) {
    buf[i] = high & 0xff;
    high = Math.floor(high / 256);
  }
  return buf;
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, counterBytes(counter) as BufferSource)
  );
  // Dynamic truncation (RFC 4226 §5.3).
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

// The current code for a base32 secret — exported for enrollment tests.
export async function totpCode(
  secretBase32: string,
  atMs: number = Date.now()
): Promise<string> {
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify a user-entered code against the secret, allowing ±DEFAULT_SKEW_STEPS
// time steps for clock drift. Rejects anything that isn't exactly 6 digits
// before doing any crypto.
export async function verifyTotp(
  secretBase32: string,
  token: string,
  atMs: number = Date.now()
): Promise<boolean> {
  if (typeof token !== "string" || !/^\d{6}$/.test(token.trim())) return false;
  const code = token.trim();
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  for (let i = -DEFAULT_SKEW_STEPS; i <= DEFAULT_SKEW_STEPS; i++) {
    if (constantTimeEqual(code, await hotp(secret, counter + i))) return true;
  }
  return false;
}

// The otpauth:// URI an authenticator app imports (via QR or manual paste).
// issuer is shown as the account's provider; account labels the entry.
export function otpauthUri(
  secretBase32: string,
  account: string,
  issuer: string
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// One-time recovery codes for when the authenticator device is lost. Returned
// in plaintext once (to show the admin); the caller hashes them for storage.
// Crockford-ish base32, grouped for readability: "abcde-fghij".
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = base32Encode(crypto.getRandomValues(new Uint8Array(7)))
      .slice(0, 10)
      .toLowerCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

// Normalize a recovery code for comparison (case/format-insensitive), so
// "ABCDE-FGHIJ", "abcdefghij", and "abcde fghij" all match the stored value.
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}
