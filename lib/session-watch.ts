import type { NextRequest } from "next/server";
import { clientIp, throttleBucket } from "./rate-limit";
import { noteSessionAddress, type SessionRecord } from "./sessions";
import { eventMeta, recordSecurityEvent } from "./security-events";
import { notifySecurityEvent } from "./security-alerts";

// A live session used from an address other than its sign-in's (#382): noted
// once per address, in the audit log and out through the Security channels,
// so a copied cookie announces itself the first time it's used elsewhere.
// Every admin API call passes through here (lib/api-auth adminSessionId), so
// a session that moved is seen on its first request from the new place; the
// admin's own phone changing networks is noted once per network. IPv6
// addresses count by their /64, so privacy extensions rotating inside one
// allotment don't raise it.
export async function watchSessionAddress(request: NextRequest, session: SessionRecord): Promise<void> {
  const ip = clientIp(request);
  if (!ip || !session.ip) return;
  if (throttleBucket(ip) === throttleBucket(session.ip)) return;
  if (session.addresses?.some((a) => throttleBucket(a) === throttleBucket(ip))) return;
  if (!(await noteSessionAddress(session.id, ip))) return;
  notifySecurityEvent(
    await recordSecurityEvent("session.moved", eventMeta(request), `signed in from ${session.ip}`)
  );
}
