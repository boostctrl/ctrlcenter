import { NextResponse } from "next/server";
import { readConfigInternal } from "@/lib/config";
import { oidcButtonLabel, oidcReady } from "@/lib/oidc";

// Which provider sign-in the sign-in prompts offer (#504): its button's
// words, or null. Public: the sign-in page shows the same button.
export async function GET() {
  const o = (await readConfigInternal()).settings.signIn.oidc;
  return NextResponse.json({ oidc: oidcReady(o) ? { label: oidcButtonLabel(o) } : null });
}
