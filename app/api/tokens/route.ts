import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { createToken, listTokens, TooManyTokensError, TOKEN_SCOPES } from "@/lib/api-tokens";
import { requireRecentAuth } from "@/lib/reauth";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { notifySecurityEvent } from "@/lib/security-alerts";
import { z } from "zod";

// Personal API tokens (#538): an account's own, for its account page; every
// account's with ?all=1, for an admin. Never the tokens themselves, which
// are shown once when made. Not reachable with a token (lib/token-routes.ts).
export async function GET(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const all = request.nextUrl.searchParams.get("all") === "1";
  if (all && !viewer.isAdmin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ tokens: await listTokens(all ? undefined : viewer.account.id) });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name the token").max(60),
  scope: z.enum(TOKEN_SCOPES as [string, ...string[]]).default("read"),
  // Days until it expires; null for never.
  expiresInDays: z.union([z.number().int().min(1).max(3650), z.null()]).default(90),
});

// A new token for the asking account. It opens a way in, so it takes a
// recent confirmation and is recorded. The actions scope is an admin's to
// give itself: a member's token reads.
export async function POST(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (parsed.data.scope === "actions" && !viewer.isAdmin) {
    return NextResponse.json({ error: "Only an admin's token can take actions" }, { status: 403 });
  }
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  try {
    const made = await createToken(
      viewer.account.id,
      parsed.data.name,
      parsed.data.scope as (typeof TOKEN_SCOPES)[number],
      parsed.data.expiresInDays
    );
    notifySecurityEvent(await recordSecurityEvent("token.created", eventMeta(request, viewer.account.id), made.record.name));
    return NextResponse.json(made, { status: 201 });
  } catch (e) {
    if (e instanceof TooManyTokensError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
