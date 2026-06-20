import { NextRequest, NextResponse } from "next/server";
import {
  verifyEnvPassword,
  verifyPasswordHash,
  hashPassword,
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
  return NextResponse.json({ ok: true });
}
