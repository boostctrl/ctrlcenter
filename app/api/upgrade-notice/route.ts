import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { dismissUpgradeNotice } from "@/lib/config";

// Admin-only: dismiss the one-time "upgraded to 3.0" banner (#306).
export async function DELETE(request: NextRequest) {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await dismissUpgradeNotice();
  return NextResponse.json({ ok: true });
}
