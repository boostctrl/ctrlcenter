import { NextRequest, NextResponse } from "next/server";
import {
  verifyEnvPassword,
  verifyPasswordHash,
  hashPassword,
  createSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";
import { readConfig, setPasswordHash } from "@/lib/config";
import { passwordChangeSchema } from "@/lib/schema";

// Admin-only (gated by the proxy matcher). Changing the password still requires
// the current one as defense-in-depth, even with a valid session.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = passwordChangeSchema.safeParse(body);
  if (!parsed.success) {
    const message =
      parsed.error.flatten().fieldErrors.next?.[0] ?? "Invalid request";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const { current, next } = parsed.data;

  const { auth } = await readConfig();
  const ok = auth.passwordHash
    ? await verifyPasswordHash(current, auth.passwordHash, auth.passwordSalt)
    : verifyEnvPassword(current);
  if (!ok) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 403 }
    );
  }

  const { hash, salt } = await hashPassword(next);
  await setPasswordHash(hash, salt);

  // Changing the password revokes every existing session (the key mixes in the
  // hash). Reissue this admin a fresh cookie bound to the new hash so they stay
  // signed in while any other sessions are invalidated.
  const token = await createSessionToken(hash);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    sessionCookieOptions(request)
  );
  return response;
}
