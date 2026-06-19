import { NextResponse } from "next/server";

// Lightweight liveness probe for Docker/orchestrators. Intentionally does no
// config or auth work so it stays fast and is reachable without a session
// (the proxy middleware matcher doesn't cover /api/health).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok", uptime: process.uptime() });
}
