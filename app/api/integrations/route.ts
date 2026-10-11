import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal, replaceIntegrations } from "@/lib/config";
import { integrationsUpdateSchema } from "@/lib/schema";

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
  // Write actions need two-factor authentication on (#367): without it the
  // opt-in is stored off, whatever the list said, and the form says why.
  const { auth } = await readConfigInternal();
  const integrations = auth.totp.enabled
    ? parsed.data
    : parsed.data.map((i) => (i.allowActions ? { ...i, allowActions: false } : i));
  await replaceIntegrations(integrations);
  return NextResponse.json({ ok: true });
}
