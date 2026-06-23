import { NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { loadHistory, getHistory } from "@/lib/status-history";
import type { StatusHistory } from "@/lib/status";

// Public read of the recorded uptime history (per-app uptime % + daily timeline)
// the /status page charts. The data is produced by the background poller; here we
// just read the in-memory store (loading from disk if the poller hasn't yet).
export const dynamic = "force-dynamic";

export async function GET() {
  const { settings, apps } = await readConfig();
  if (!settings.statusChecks) {
    const empty: StatusHistory = { generatedAt: Date.now(), apps: [] };
    return NextResponse.json(empty);
  }
  await loadHistory();
  return NextResponse.json(getHistory(apps.map((a) => a.id)));
}
