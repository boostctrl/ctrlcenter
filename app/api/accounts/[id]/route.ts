import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { deleteAccount, NotFoundError, readConfigInternal, updateAccount } from "@/lib/config";
import { findAccount } from "@/lib/accounts";
import { requireRecentAuth } from "@/lib/reauth";
import { accountUpdateSchema, FOUNDING_ACCOUNT_ID } from "@/lib/schema";
import { revokeSessions } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

type Params = { params: Promise<{ id: string }> };

// Edit an account (#423): its display name, role, groups, whether it is
// enabled and whether its next sign-in must set a new password. Making
// someone an admin takes a recent confirmation; the founding admin stays an
// enabled admin (lib/config/auth.ts); nobody disables or demotes themselves.
export async function PATCH(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = accountUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const patch = parsed.data;
  if (!findAccount(config.auth, id)) return NextResponse.json({ error: "No such account" }, { status: 404 });
  if (id === viewer.account.id && (patch.enabled === false || patch.role === "member")) {
    return NextResponse.json({ error: "You can't disable or demote your own account" }, { status: 400 });
  }
  if (patch.role === "admin") {
    const recent = await requireRecentAuth(request, config.auth);
    if (!recent.ok) return recent.response;
  }
  try {
    const account = await updateAccount(id, patch);
    // A disabled account's sessions end with it.
    if (patch.enabled === false) await revokeSessions(undefined, id);
    await recordSecurityEvent("account.changed", eventMeta(request, viewer.account.id), id);
    const { passwordHash: _h, passwordSalt: _s, totp, ...shown } = account;
    void _h; void _s;
    return NextResponse.json({ ...shown, totp: totp.enabled });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "No such account" }, { status: 404 });
    throw e;
  }
}

// Remove an account (#423), ending its sessions. Never the founding admin,
// never yourself. Step-up: it is irreversible.
export async function DELETE(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (id === FOUNDING_ACCOUNT_ID) return NextResponse.json({ error: "The founding admin account can't be removed" }, { status: 400 });
  if (id === viewer.account.id) return NextResponse.json({ error: "You can't remove your own account" }, { status: 400 });
  if (!findAccount(config.auth, id)) return NextResponse.json({ error: "No such account" }, { status: 404 });
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  await deleteAccount(id);
  await revokeSessions(undefined, id);
  notifySecurityEvent(await recordSecurityEvent("account.deleted", eventMeta(request, viewer.account.id), id));
  return new NextResponse(null, { status: 204 });
}
