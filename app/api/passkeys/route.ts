import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { verifyFlow } from "@/lib/auth";
import { PasskeyLimitError, addPasskey, readConfigInternal } from "@/lib/config";
import { REGISTER_COOKIE, relyingParty, verifyRegistration } from "@/lib/passkeys";
import { requireRecentAuth } from "@/lib/reauth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";
import { log, errorReason } from "@/lib/log";

// The asking account's passkeys (#537): what each is called, where it
// works, when it was made and last used. Never the keys.
export async function GET(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer || viewer.token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    host: relyingParty(request).rpId,
    passkeys: viewer.account.passkeys.map(({ id, name, rpId, createdAt, lastUsedAt }) => ({ id, name, rpId, createdAt, lastUsedAt })),
  });
}

// The browser's new passkey, checked against the challenge the options
// call kept, and added to the account. A recent confirmation again, and
// recorded and announced: a new way in.
export async function POST(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer || viewer.token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  const flow = await verifyFlow<{ challenge: string; account: string }>(request.cookies.get(REGISTER_COOKIE)?.value, "passkey-add");
  if (!flow || flow.account !== viewer.account.id) {
    return NextResponse.json({ error: "That took too long. Try adding it again." }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  let passkey;
  try {
    passkey = await verifyRegistration(request, body?.response, flow.challenge, typeof body?.name === "string" ? body.name : "");
  } catch (e) {
    log.warn("a passkey couldn't be added", { reason: errorReason(e) });
    passkey = null;
  }
  if (!passkey) return NextResponse.json({ error: "The browser's passkey didn't check out." }, { status: 400 });
  try {
    await addPasskey(viewer.account.id, passkey);
  } catch (e) {
    if (e instanceof PasskeyLimitError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  notifySecurityEvent(await recordSecurityEvent("passkey.added", eventMeta(request, viewer.account.id), passkey.name));
  const res = NextResponse.json({ id: passkey.id, name: passkey.name, rpId: passkey.rpId, createdAt: passkey.createdAt, lastUsedAt: null }, { status: 201 });
  res.cookies.delete({ name: REGISTER_COOKIE, path: "/api/passkeys" });
  return res;
}
