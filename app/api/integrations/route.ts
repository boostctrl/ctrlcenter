import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal, replaceIntegrations } from "@/lib/config";
import { integrationsUpdateSchema, type Integration } from "@/lib/schema";
import { requireRecentAuth } from "@/lib/reauth";

const TARGET_FIELDS = ["url", "username", "password", "apiKey", "allowInsecureTls"] as const;

function changesTarget(next: Integration[], stored: Integration[]): boolean {
  return next.some((i) => {
    const was = stored.find((o) => o.id === i.id);
    if (!was) return TARGET_FIELDS.some((k) => i[k] !== "" && i[k] !== false) || i.allowActions;
    return TARGET_FIELDS.some((k) => i[k] !== was[k]) || (i.allowActions && !was.allowActions);
  });
}

// Admin-only: replace the integrations (#300) — the list admin Settings →
// Integrations edits and autosaves whole. Answers with nothing but ok: the
// credentials never travel back.
export async function PUT(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = integrationsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid integrations" },
      { status: 400 }
    );
  }
  const { auth, integrations: stored } = await readConfigInternal();
  // Step-up (#366) when the save changes what a credential reaches or turns
  // actions on: a new integration with credentials, an edited URL, username,
  // password or key, or the opt-in flipping on. Renames, reorders, removals
  // and the enable toggle pass on the session alone, so the autosave only
  // asks when it matters.
  if (changesTarget(parsed.data, stored)) {
    const recent = await requireRecentAuth(request, auth.passwordHash);
    if (!recent.ok) return recent.response;
  }
  // Write actions need two-factor authentication on (#367): without it the
  // opt-in is stored off, whatever the list said, and the form says why.
  const integrations = auth.totp.enabled
    ? parsed.data
    : parsed.data.map((i) => (i.allowActions ? { ...i, allowActions: false } : i));
  await replaceIntegrations(integrations);
  return NextResponse.json({ ok: true });
}
