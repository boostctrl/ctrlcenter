import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import { addAccountGroup, GroupExistsError, readConfigInternal } from "@/lib/config";
import { groupNameSchema } from "@/lib/schema";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { z } from "zod";

const createSchema = z.object({ id: groupNameSchema });

// A new group on the list (#505), empty until an account joins it or
// something is shared with it. Not a step-up: on its own it shows nothing
// to anyone. The list itself comes with GET /api/accounts.
export async function POST(request: NextRequest) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  try {
    await addAccountGroup(parsed.data.id);
  } catch (e) {
    if (e instanceof GroupExistsError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  await recordSecurityEvent("group.changed", eventMeta(request, viewer.account.id), `${parsed.data.id} added`);
  return NextResponse.json({ id: parsed.data.id }, { status: 201 });
}
