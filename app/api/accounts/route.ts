import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { addAccount, AccountExistsError, readConfigInternal } from "@/lib/config";
import { accountsOf } from "@/lib/accounts";
import { hashPassword } from "@/lib/auth";
import { requireRecentAuth } from "@/lib/reauth";
import { accountCreateSchema, userSchema } from "@/lib/schema";
import { listSessions, sessionAccount } from "@/lib/sessions";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";

// The accounts and the groups they belong to (#423), for the admin's
// pickers and the Users tab: names, roles, groups, whether each is enabled,
// has a second factor, must change its password, when it last signed in and
// how many sessions it holds. Never a credential or a secret.
export async function GET(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sessions = await listSessions();
  const accounts = accountsOf(config.auth).map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    enabled: u.enabled,
    groups: u.groups,
    totp: u.totp.enabled,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt,
    lastSignInAt: u.lastSignInAt,
    sessions: sessions.filter((s) => sessionAccount(s) === u.id).length,
  }));
  const groups = [...new Set(accounts.flatMap((a) => a.groups))].sort();
  // `current`: the asking admin's own account, which the Users tab treats
  // with care (no disabling or removing oneself).
  return NextResponse.json({ accounts, groups, current: viewer.account.id });
}

// A new account (#423), with the first password the admin hands over and,
// by default, a new one to be chosen at its first sign-in. Step-up: it
// creates a way in.
export async function POST(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  const parsed = accountCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { password, ...rest } = parsed.data;
  const { hash, salt } = await hashPassword(password);
  const account = userSchema.parse({
    ...rest,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: new Date().toISOString(),
  });
  try {
    await addAccount(account);
  } catch (e) {
    if (e instanceof AccountExistsError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  notifySecurityEvent(await recordSecurityEvent("account.created", eventMeta(request, viewer.account.id), account.id));
  const { passwordHash: _h, passwordSalt: _s, totp: _t, ...shown } = account;
  void _h; void _s; void _t;
  return NextResponse.json({ ...shown, totp: false, sessions: 0 }, { status: 201 });
}
