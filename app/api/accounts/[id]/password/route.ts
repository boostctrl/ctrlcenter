import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { hashPassword } from "@/lib/auth";
import { NotFoundError, readConfigInternal, resetAccountPassword } from "@/lib/config";
import { findAccount } from "@/lib/accounts";
import { requireRecentAuth } from "@/lib/reauth";
import { accountPasswordResetSchema } from "@/lib/schema";
import { revokeSessions } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

type Params = { params: Promise<{ id: string }> };

// An admin resets another account's password (#423): the account's
// sessions end, and it must choose its own password at its next sign-in.
// Step-up: it is a way into that account. One's own password changes
// through POST /api/password, which takes the current one.
export async function POST(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (id === viewer.account.id) {
    return NextResponse.json({ error: "Change your own password in Settings → Security" }, { status: 400 });
  }
  if (!findAccount(config.auth, id)) return NextResponse.json({ error: "No such account" }, { status: 404 });
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  const parsed = accountPasswordResetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { hash, salt } = await hashPassword(parsed.data.password);
  try {
    await resetAccountPassword(id, hash, salt);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "No such account" }, { status: 404 });
    throw e;
  }
  await revokeSessions(undefined, id);
  notifySecurityEvent(await recordSecurityEvent("password.reset", eventMeta(request, viewer.account.id), id));
  return NextResponse.json({ ok: true });
}
