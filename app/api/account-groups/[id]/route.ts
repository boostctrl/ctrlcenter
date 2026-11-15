import { NextRequest, NextResponse } from "next/server";
import { viewerOf } from "@/lib/api-auth";
import {
  GroupExistsError,
  NotFoundError,
  readConfigInternal,
  removeAccountGroup,
  renameAccountGroup,
} from "@/lib/config";
import { requireRecentAuth } from "@/lib/reauth";
import { groupNameSchema } from "@/lib/schema";
import { eventMeta, recordSecurityEvent } from "@/lib/security-events";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

// A rename: the new name, and `merge` to fold the group into one that
// already has that name.
const renameSchema = z.object({ id: groupNameSchema, merge: z.boolean().default(false) });

// Both handlers change who sees what — every account and audience naming
// the group is rewritten — so both take a recent confirmation, as making an
// admin does.

// Rename a group (#505) on every account and in every audience. A name that
// is taken answers 409 unless the request asks to merge.
export async function PATCH(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  const { id } = await params;
  const parsed = renameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { id: to, merge } = parsed.data;
  try {
    await renameAccountGroup(id, to, { merge });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "No such group" }, { status: 404 });
    if (e instanceof GroupExistsError) return NextResponse.json({ error: e.message, exists: true }, { status: 409 });
    throw e;
  }
  await recordSecurityEvent(
    "group.changed",
    eventMeta(request, viewer.account.id),
    `${id} ${merge ? "merged into" : "renamed to"} ${to}`
  );
  return NextResponse.json({ id: to });
}

// Remove a group (#505) from the list, every account and every audience;
// an item shared with it alone becomes admins-only.
export async function DELETE(request: NextRequest, { params }: Params) {
  const config = await readConfigInternal();
  const viewer = await viewerOf(request, config.auth);
  if (!viewer?.isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const recent = await requireRecentAuth(request, config.auth);
  if (!recent.ok) return recent.response;
  const { id } = await params;
  try {
    await removeAccountGroup(id);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "No such group" }, { status: 404 });
    throw e;
  }
  await recordSecurityEvent("group.changed", eventMeta(request, viewer.account.id), `${id} removed`);
  return new NextResponse(null, { status: 204 });
}
