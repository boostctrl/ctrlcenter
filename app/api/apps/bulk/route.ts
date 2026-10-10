import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { bulkUpdateApps } from "@/lib/config";
import { appsBulkSchema } from "@/lib/schema";

// Admin-only: move several apps to a group and/or tag them at once (#299).
// Answers with the apps and the groups (the named group may be new).
export async function PATCH(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const parsed = appsBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  return NextResponse.json(await bulkUpdateApps(parsed.data));
}
