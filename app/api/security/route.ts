import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { collectSecurityFacts, securityChecklist } from "@/lib/security-checklist";

// Admin-only (gated by the /api/security proxy prefix and re-checked here).
// The security checklist (#367) for Settings → Security: what the app can
// see of this deployment's posture, as rows with a fix each.
export async function GET(request: NextRequest) {
  const config = await readConfigInternal();
  if (!(await isAdminRequest(request, config.auth))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ rows: securityChecklist(await collectSecurityFacts(config)) });
}
