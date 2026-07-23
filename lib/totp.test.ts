import { describe, expect, it } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  totpCode,
  verifyTotp,
  otpauthUri,
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from "./totp";

// RFC 4226 Appendix D: the shared secret is the ASCII "12345678901234567890".
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
// HOTP(secret, counter) for counters 0..9 (RFC 4226 Appendix D).
const RFC_HOTP = [
  "755224", "287082", "359152", "969429", "338314",
  "254676", "287922", "162583", "399871", "520489",
];

describe("base32", () => {
  it("encodes the RFC test secret to the expected base32", () => {
    const bytes = new TextEncoder().encode(RFC_SECRET_ASCII);
    expect(base32Encode(bytes)).toBe(RFC_SECRET_BASE32);
  });

  it("round-trips arbitrary bytes and tolerates spaces/lowercase on decode", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    const encoded = base32Encode(bytes);
    expect([...base32Decode(encoded)]).toEqual([...bytes]);
    // A pasted, human-formatted secret still decodes.
    const spaced = encoded.match(/.{1,4}/g)!.join(" ").toLowerCase();
    expect([...base32Decode(spaced)]).toEqual([...bytes]);
  });
});

describe("totpCode (RFC 4226 vectors)", () => {
  it("matches HOTP for counters 0..9", async () => {
    for (let counter = 0; counter < RFC_HOTP.length; counter++) {
      // A time inside step `counter` (period 30s) selects that HOTP counter.
      const code = await totpCode(RFC_SECRET_BASE32, counter * 30_000);
      expect(code, `counter ${counter}`).toBe(RFC_HOTP[counter]);
    }
  });
});

describe("verifyTotp", () => {
  it("accepts the current code and rejects a wrong one", async () => {
    const now = 5 * 30_000; // step 5
    expect(await verifyTotp(RFC_SECRET_BASE32, RFC_HOTP[5], now)).toBe(true);
    expect(await verifyTotp(RFC_SECRET_BASE32, "000000", now)).toBe(false);
  });

  it("allows ±1 step of clock skew", async () => {
    const now = 5 * 30_000;
    // A code from the previous and next step still verifies.
    expect(await verifyTotp(RFC_SECRET_BASE32, RFC_HOTP[4], now)).toBe(true);
    expect(await verifyTotp(RFC_SECRET_BASE32, RFC_HOTP[6], now)).toBe(true);
    // But not two steps away.
    expect(await verifyTotp(RFC_SECRET_BASE32, RFC_HOTP[7], now)).toBe(false);
  });

  it("rejects anything that isn't six digits", async () => {
    const now = 5 * 30_000;
    expect(await verifyTotp(RFC_SECRET_BASE32, "12345", now)).toBe(false);
    expect(await verifyTotp(RFC_SECRET_BASE32, "1234567", now)).toBe(false);
    expect(await verifyTotp(RFC_SECRET_BASE32, "abcdef", now)).toBe(false);
    expect(await verifyTotp("", "755224", 0)).toBe(false);
  });
});

describe("generateTotpSecret", () => {
  it("returns a 32-char base32 secret (160 bits) that its own code verifies", async () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(await verifyTotp(secret, await totpCode(secret))).toBe(true);
  });
});

describe("otpauthUri", () => {
  it("encodes the secret, issuer, and algorithm params", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "admin", "CtrlCenter");
    expect(uri).toContain("otpauth://totp/CtrlCenter:admin?");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=CtrlCenter");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
  });
});

describe("recovery codes", () => {
  it("generates unique formatted codes", () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
  });

  it("normalizes format/case for comparison", () => {
    expect(normalizeRecoveryCode("ABCDE-FGHIJ")).toBe("abcdefghij");
    expect(normalizeRecoveryCode("abcde fghij")).toBe("abcdefghij");
  });
});
