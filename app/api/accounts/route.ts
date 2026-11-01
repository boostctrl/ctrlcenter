import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/api-auth";
import { readConfigInternal } from "@/lib/config";
import { accountsOf } from "@/lib/accounts";

// The accounts and the groups they belong to, for the admin's pickers
// (#423): names, roles and groups, never a credential or a second factor.
export async function GET(request: NextRequest) {
  const config = await readConfigInternal();
  if (!(await isAdminRequest(request, config.auth))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const accounts = accountsOf(config.auth).map(({ id, name, role, enabled, groups }) => ({
    id,
    name,
    role,
    enabled,
    groups,
  }));
  const groups = [...new Set(accounts.flatMap((a) => a.groups))].sort();
  return NextResponse.json({ accounts, groups });
}
