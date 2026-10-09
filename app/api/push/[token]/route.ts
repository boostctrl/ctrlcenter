import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readConfigInternal } from "@/lib/config";
import { recordPush } from "@/lib/push";
import { rateLimit, pruneRateLimit, clientKey } from "@/lib/rate-limit";

// Push / heartbeat checks (#294): a cron job or backup script calls an app's
// secret URL when it runs, and the app counts as up while those calls keep
// arriving. Public by design — whatever runs the job has no session — and
// gated by the per-app token, the same posture as the inbound webhooks (#204).
// GET and POST both work, so `curl -fsS <url>` is all a job needs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A job pings once per run; this is generous for any real schedule while
// keeping a misbehaving source from hammering the config read.
const MAX_PER_WINDOW = 30;
const WINDOW_MS = 60 * 1000;

// Constant-time comparison; the token is random, so its length isn't secret.
function tokenMatches(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ping(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  pruneRateLimit();
  const limit = rateLimit(clientKey(request, "push"), MAX_PER_WINDOW, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }
  const { apps } = await readConfigInternal();
  const app = apps.find((a) => a.checkType === "push" && tokenMatches(token, a.pushToken));
  // One answer for every miss: the endpoint never says whether a token was
  // once valid or which apps exist.
  if (!app) return NextResponse.json({ error: "Unknown push URL" }, { status: 404 });
  recordPush(app.id);
  return NextResponse.json({ ok: true });
}

export const GET = ping;
export const POST = ping;
