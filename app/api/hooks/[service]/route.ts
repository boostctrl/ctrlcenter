import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { readConfigInternal } from "@/lib/config";
import { WEBHOOK_SERVICES, type WebhookService } from "@/lib/schema";
import { keyForLog, parseWebhook, reportOptions } from "@/lib/webhooks";
import { holdForDigest } from "@/lib/webhook-digest";
import { sendNotification, anyChannelReady } from "@/lib/alerts";
import { rateLimit, pruneRateLimit, clientKey } from "@/lib/rate-limit";
import { log } from "@/lib/log";

// Inbound webhooks (#204): Sonarr/Radarr/Seerr POST an event here and we
// relay it out through the configured alert channels. Public by design — this
// path sits outside the proxy's admin gate so an external app can reach it — but
// gated by a per-service token, so it's never an open relay. Runs on Node (it
// reads the config file and uses node:crypto); force-dynamic so it never caches.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A webhook body is one event's JSON — a season pack's import lists every
// file, with artwork and genres — so cap it generously, but cap it, so a
// bad/hostile caller can't stream an unbounded body into memory.
const MAX_BYTES = 256 * 1024;
// Generous per-source rate limit — one misbehaving source shouldn't be able to
// hammer the relay — but a season upgrade is a burst in its own right: Sonarr
// fires a delete and an import per episode, seconds apart, and never retries
// a 429, so the limit sits well above the largest honest burst (#346).
const MAX_PER_WINDOW = 300;
const WINDOW_MS = 60 * 1000;

function isWebhookService(v: string): v is WebhookService {
  return (WEBHOOK_SERVICES as readonly string[]).includes(v);
}

// Constant-time token comparison. Length is checked first (a length mismatch
// can't be constant-time anyway, and the token is a random secret, so its length
// isn't sensitive); equal-length buffers then go through timingSafeEqual.
function tokenMatches(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ service: string }> }
) {
  const { service } = await params;
  if (!isWebhookService(service)) {
    return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  }

  // Throttle per source + service before any config read or delivery work.
  pruneRateLimit();
  const limit = rateLimit(
    clientKey(request, `hook:${service}`),
    MAX_PER_WINDOW,
    WINDOW_MS
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const token = new URL(request.url).searchParams.get("token") ?? "";
  const { settings } = await readConfigInternal();
  const svc = settings.webhooks[service];
  // One uniform 401 whether the master switch is off, this service is off, or
  // the token is wrong — the endpoint never reveals which services exist or are
  // wired up.
  if (
    !settings.webhooks.enabled ||
    !svc.enabled ||
    !tokenMatches(token, svc.token)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Size guard: reject an oversized declared body, and re-check after reading in
  // case the header lied.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const text = await request.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  const notification = parseWebhook(service, payload);
  // Unrecognized/empty event: accept it so the sender's test doesn't error, but
  // there's nothing to relay.
  if (!notification) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Delivered independently of the uptime-alert master switch (that gates the
  // poller); this only needs a channel to send through. Accept-but-note when
  // none is set so the sender's Test still succeeds instead of 5xx-ing.
  if (!anyChannelReady(settings.alerts)) {
    log.info("webhook received but no alert channel configured", { service });
    return NextResponse.json({ ok: true, delivered: false });
  }

  // An event that may be one of a burst waits for the burst to go quiet and
  // goes out merged with its fellows (#346, lib/webhook-digest.ts); a Test, a
  // health issue or anything else the parser left out of a digest, and every
  // event while the window is off, is relayed at once as before — as is one
  // the store has no room to hold.
  const windowMs = settings.webhooks.digestSeconds * 1000;
  if (windowMs > 0 && notification.digest) {
    const key = keyForLog(notification.digest.key);
    const held = holdForDigest(notification, {
      windowMs,
      send: async (merged) => {
        // Read the config afresh: a channel added or edited while the burst
        // was pending is honoured, and one removed meanwhile isn't sent to.
        const { settings } = await readConfigInternal();
        if (!anyChannelReady(settings.alerts)) {
          log.info("webhook digest dropped: no alert channel configured", { service });
          return;
        }
        await sendNotification(settings.alerts, merged, {
          at: Date.now(),
          timeZone: settings.timezone,
          siteTitle: settings.title,
          options: reportOptions(settings.webhooks),
        });
      },
    });
    if (held) {
      log.debug("webhook held for digest", { service, key });
      return NextResponse.json({ ok: true, queued: true });
    }
    log.debug("webhook digest store full, relaying at once", { service, key });
  }

  // The report options (#347) are read with the rest of the settings, so a
  // toggle flipped while a burst was pending applies when it goes out.
  await sendNotification(settings.alerts, notification, {
    at: Date.now(),
    timeZone: settings.timezone,
    siteTitle: settings.title,
    options: reportOptions(settings.webhooks),
  });
  log.info("webhook relayed", { service });
  return NextResponse.json({ ok: true, delivered: true });
}
