import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { replaceIntegrations } from "@/lib/config";
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
  await replaceIntegrations(parsed.data);
  return NextResponse.json({ ok: true });
}
