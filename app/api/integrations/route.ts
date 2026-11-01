import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal, replaceIntegrations, restoreIntegrations } from "@/lib/config";
import { integrationsPatchSchema, integrationsUpdateSchema, type Integration } from "@/lib/schema";
import { applyListPatch } from "@/lib/list-patch";
import { requireRecentAuth } from "@/lib/reauth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";
import { integrationLabels } from "@/lib/services/ids";

const TARGET_FIELDS = ["url", "username", "password", "apiKey", "allowInsecureTls"] as const;

function changesTarget(next: Integration[], stored: Integration[]): boolean {
  return next.some((i) => {
    const was = stored.find((o) => o.id === i.id);
    if (!was) return TARGET_FIELDS.some((k) => i[k] !== "" && i[k] !== false) || i.allowActions;
    return TARGET_FIELDS.some((k) => i[k] !== was[k]) || (i.allowActions && !was.allowActions);
  });
}

// Admin-only: the integrations (#300). Settings → Integrations sends what it
// changed since its last save (#396: upsert / remove / order, applied to the
// stored list); a plain array replaces the list whole. Answers with nothing
// but ok: the credentials never travel back.
export async function PUT(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const { auth, integrations: stored } = await readConfigInternal();
  let list: unknown = body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const patch = integrationsPatchSchema.safeParse(body);
    if (!patch.success) {
      return NextResponse.json({ error: patch.error.issues[0]?.message ?? "Invalid integrations" }, { status: 400 });
    }
    list = applyListPatch(stored, patch.data);
  }
  const parsed = integrationsUpdateSchema.safeParse(list);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid integrations" },
      { status: 400 }
    );
  }
  // A placeholder the form sent back stands for the stored credential (#382).
  const incoming = restoreIntegrations(parsed.data, stored);
  // Step-up (#366) when the save changes what a credential reaches or turns
  // actions on: a new integration with credentials, an edited URL, username,
  // password or key, or the opt-in flipping on. Renames, reorders, removals
  // and the enable toggle pass on the session alone, so the autosave only
  // asks when it matters.
  const targetChanged = changesTarget(incoming, stored);
  if (targetChanged) {
    const recent = await requireRecentAuth(request, auth);
    if (!recent.ok) return recent.response;
  }
  // Write actions need two-factor authentication on (#367): without it the
  // opt-in is stored off, whatever the list said, and the form says why.
  const integrations = auth.totp.enabled
    ? incoming
    : incoming.map((i) => (i.allowActions ? { ...i, allowActions: false } : i));
  await replaceIntegrations(integrations);
  // The audit log (#368): credential or address edits, and actions turned
  // on (which also goes out through the channels).
  const labels = integrationLabels(integrations);
  const turnedOn = integrations
    .filter((i) => i.allowActions && !stored.find((o) => o.id === i.id)?.allowActions)
    .map((i) => labels[i.id]);
  if (turnedOn.length > 0) {
    notifySecurityEvent(await recordSecurityEvent("actions.enabled", eventMeta(request), turnedOn.join(", ")));
  } else if (targetChanged) {
    await recordSecurityEvent("integration.changed", eventMeta(request));
  }
  return NextResponse.json({ ok: true });
}
